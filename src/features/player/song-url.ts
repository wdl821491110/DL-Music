import { pickStringLike, pickText, toRecords } from '@/lib/api-parse';
import { normalizeDurationMs, stripEmTags, artistMatches } from '@/lib/format';
import { mobileApi } from '@/lib/kugou-api';
import { resolveAltPlaybackUrl } from '@/lib/alt-source';

import { getAltSourceFallback, getPreferredQuality, type QualityId } from '@/features/settings/store';

import type { PlayerTrack } from './types';

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function collectUrls(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  return [];
}

export class PlaybackUnavailableError extends Error {}

export type ResolvedSongSource = {
  uri: string;
  durationMs: number;
  /** 音源码率（bps）；非会员账号各档位可能都返回试听码率，用于跳过无意义的换源。 */
  bitrate?: number;
  /** 实际取链成功所用音源标识；换源兜底后可能与曲目自带 hash 不同，供上层回写。 */
  hash?: string;
  albumAudioId?: string;
  /** 是否来自备用音源兜底；上层可据此提示用户"酷狗无版权，已切换备用音源"。 */
  fromAltSource?: boolean;
};

type SongUrlArgs = {
  hash: string;
  album_id: string | number;
  album_audio_id: string | number;
  /** 酷狗音质标识：128 / 320 / flac；缺省为 128。 */
  quality?: string;
  /** true 只要试听片段（IsFreePart:1）；false/undefined 请求完整版（IsFreePart:0）。 */
  freePart?: boolean;
  /** 取链页 ID；电脑版用单一 356753938，比默认的逗号串更容易命中权益。 */
  ppageId?: string;
};

type SongUrlOutcome = {
  status: number;
  urls: string[];
  timeLength: unknown;
  bitrate: unknown;
  /** 是否只拿到试听片段（IsFreePart:1）。会员受限的歌常见"有 URL 但只是试听"，不能当成完整源。 */
  isTrial: boolean;
};

/** 音质档由高到低；与桌面版 QUALITY_LEVELS 的播放档保持一致。 */
const QUALITY_CHAIN = ['flac', '320', '128'] as const;
/** 电脑版取链固定使用单一 ppage_id（不是默认的逗号串），实测权益命中率更高。 */
const DESKTOP_PPAGE_ID = '356753938';

type PrivilegeCandidate = { hash: string; quality: string };

/** 是否只拿到试听片段：显式标记，或时长明显短于曲目（非会员各档返回同一试听片段）。 */
function isTrialOutcome(outcome: SongUrlOutcome, track: PlayerTrack): boolean {
  const duration = normalizeDurationMs(outcome.timeLength);
  return (
    outcome.isTrial ||
    (!!duration && !!track.durationMs && duration < track.durationMs * 0.6)
  );
}

/**
 * 取链前先向服务端探测「本账号对这首歌实际可用的音质档及其专属 hash」——这是主路径，
 * 不是可选补丁。上游电脑版（OnlineMusicQueue）正是先调 /privilege/lite 拿到各档 hash，
 * 再用这些 hash 逐档取链，付费/会员歌才能播；原手机版跳过这步、直接拿歌单原始 hash 硬取，
 * 服务端对不上权益 → 判为无版权/VIP。
 *
 * 综合判定策略：
 * - 探测成功：用返回的专属 hash，按「偏好档 → 更低档」逐档生成候选；
 * - 探测失败 / 风控 / 无结果：仍生成「原始 hash 逐档降级」候选（多档穷举，不是单点重试）；
 *   两条路径都带单一 ppage_id，由调用方逐档试到拿到完整源为止。
 * 这样无论探测成败，走的都是完整的多候选取链，不再是"退回现状"。
 */
async function getPrivilegeCandidates(track: PlayerTrack, preferred: QualityId): Promise<PrivilegeCandidate[]> {
  const start = Math.max(0, QUALITY_CHAIN.indexOf(preferred as (typeof QUALITY_CHAIN)[number]));
  const chain = QUALITY_CHAIN.slice(start);
  const rawHash = (track.hash || '').toLowerCase();

  // 默认候选：原始 hash 逐档降级（探测失败时用它，仍比单点 try 覆盖更全）
  const fallback: PrivilegeCandidate[] = chain.map((q) => ({ hash: rawHash, quality: q }));

  if (!track.hash) return fallback;
  try {
    // album_id 必须是字符串：privilege_lite.js 内部用 String(...).split(',') 解析，
    // 传数字会 .split is not a function 抛错，导致探测永远失败（此前"等于没改"的根因）。
    const response = await mobileApi.privilege_lite({
      hash: track.hash,
      album_id: String(track.albumId ?? 0),
    });
    const body = toRecord(response?.body);
    // status 非 1 = 失败 / 风控 / 验证拦截：放弃本次探测结果，用默认逐档候选
    if (Number(body.status ?? 0) !== 1) return fallback;

    const items = toRecords(body.data);
    // 权益信息在 item 本身 + relate_goods 里，各音质档带各自的 hash。
    const hashByQuality = new Map<string, string>();
    for (const item of items) {
      for (const variant of [item, ...toRecords(item.relate_goods)]) {
        const hash = pickText(variant.hash).toLowerCase();
        const quality = pickText(variant.quality).toLowerCase();
        // 与桌面版一致：level=0 表示无权益，跳过（否则会选到仍受限的 hash）
        const level = Number(variant.level ?? 0);
        if (
          hash &&
          level !== 0 &&
          QUALITY_CHAIN.includes(quality as (typeof QUALITY_CHAIN)[number]) &&
          !hashByQuality.has(quality)
        ) {
          hashByQuality.set(quality, hash);
        }
      }
    }

    // 探测到的专属 hash 优先，按偏好档往下逐档；再把「原始 hash 逐档」补在后面兜底。
    // 去重：同一 quality 只保留先出现的（专属 hash 优先），确保 tries 聚焦于最可能成功的源。
    const candidates: PrivilegeCandidate[] = [];
    const seen = new Set<string>();
    const push = (c: PrivilegeCandidate) => {
      const key = `${c.quality}`;
      if (!seen.has(key) && c.hash) {
        seen.add(key);
        candidates.push(c);
      }
    };
    for (const q of chain) {
      push({ hash: hashByQuality.get(q) ?? rawHash, quality: q });
    }
    // 探测给了额外档（如 flac 之外的档）也一并纳入，扩大覆盖
    for (const q of QUALITY_CHAIN) {
      const h = hashByQuality.get(q);
      if (h && !seen.has(q)) push({ hash: h, quality: q });
    }
    return candidates.length ? candidates : fallback;
  } catch {
    // 探测失败：返回默认逐档候选，交由调用方逐档取链（不是退回单点 try）
    return fallback;
  }
}

async function requestSongUrl(args: SongUrlArgs): Promise<SongUrlOutcome> {
  try {
    const response = await mobileApi.song_url({
      hash: args.hash,
      album_id: args.album_id,
      album_audio_id: args.album_audio_id,
      quality: args.quality,
      free_part: args.freePart ? 1 : 0,
      // 对齐电脑版：单一 ppage_id，避免默认逗号串导致服务端权益判定偏差
      ...(args.ppageId ? { ppage_id: args.ppageId } : {}),
    });

    const body = toRecord(response.body);
    return {
      status: Number(body.status ?? 0),
      urls: [
        ...collectUrls(body.url),
        ...collectUrls(body.backupUrl),
        ...collectUrls(body.backup_url),
      ],
      timeLength: body.timeLength,
      bitrate: body.bitrate ?? body.bitRate,
      isTrial: args.freePart === true,
    };
  } catch {
    // 传输层失败（网关 status=0 / 网络抖动 / SSA 风控）时，底层 reject 的是
    // 非 Error 的 {status, body, cookie} 对象。若放任抛出，会绕过试听回退、
    // 音质降级、换源、备用音源整条兜底链，最终只显示通用「播放失败」文案。
    // 这里转成「没拿到链接」的空 outcome，让上层继续按既有顺序兜底。
    return { status: 0, urls: [], timeLength: undefined, bitrate: undefined, isTrial: false };
  }
}

function normalizeTitle(value: string): string {
  return stripEmTags(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * 歌单等接口下发的 hash 不一定是可播的标准音源（酷狗 /v5/url 会因此返回 status 3），
 * 取不到链接时用“歌手 + 歌名”重新搜索，换搜索结果里的标准 FileHash 再试一次。
 */
async function findSearchReplacement(track: PlayerTrack): Promise<SongUrlArgs | null> {
  const keyword = track.artist && track.artist !== '未知歌手' ? `${track.artist} ${track.title}` : track.title;
  if (!keyword.trim()) {
    return null;
  }

  try {
    const response = await mobileApi.search({ keywords: keyword, page: 1, pagesize: 10, type: 'song' });
    const records = toRecords(toRecord(toRecord(response.body).data).lists);
    const title = normalizeTitle(track.title);
    const artistUnknown = !track.artist || track.artist === '未知歌手';
    const candidates = records
      .map((item) => ({
        hash: pickText(item.FileHash),
        title: pickText(item.OriSongName, item.SongName, item.FileName),
        artist: pickText(item.Singername, item.SingerName),
        albumId: pickStringLike(item.AlbumID),
        albumAudioId: pickStringLike(item.MixSongID),
      }))
      .filter(
        (item) =>
          item.hash &&
          normalizeTitle(item.title) === title &&
          // 同名资源（如同名有声书）可能排在前面，按歌手严格匹配避免换错音源。
          (artistUnknown || artistMatches(item.artist, track.artist))
      );
    if (!candidates.length) {
      return null;
    }

    // 先用 albumAudioId 精确对上同一首（同名不同版本时唯一可靠的区分依据）。
    const exactAlbumMatch = track.albumAudioId
      ? candidates.find((item) => item.albumAudioId === track.albumAudioId)
      : undefined;
    if (exactAlbumMatch) {
      return {
        hash: exactAlbumMatch.hash,
        album_id: exactAlbumMatch.albumId || 0,
        album_audio_id: exactAlbumMatch.albumAudioId || 0,
      };
    }

    // 歌手没解析出来、又没有 albumAudioId 可精确对上：同名候选多个时无法确认是哪首，
    // 宁可不换（上层按版权受限处理），也不要换成与歌单信息不符的歌。
    if (artistUnknown && candidates.length > 1) {
      return null;
    }

    const matched = candidates[0];
    return { hash: matched.hash, album_id: matched.albumId || 0, album_audio_id: matched.albumAudioId || 0 };
  } catch {
    return null;
  }
}

/** 解析歌曲真实播放地址；无版权/需付费时抛 PlaybackUnavailableError。 */
export async function resolveSongSource(
  track: PlayerTrack,
  qualityOverride?: QualityId
): Promise<ResolvedSongSource> {
  if (track.source === 'cloud') {
    return resolveCloudSource(track);
  }

  const quality = qualityOverride ?? getPreferredQuality();
  const trackArgs: SongUrlArgs = {
    hash: track.hash,
    album_id: track.albumId ?? 0,
    album_audio_id: track.albumAudioId ?? 0,
  };

  // 主路径：先探测权益，再按「专属 hash + 单一 ppage_id」逐档穷举完整版。
  // 这是电脑版能播付费歌、原手机版不能的核心差异，不再是"附加层 + 失败退回老路"。
  let outcome: SongUrlOutcome | null = null;
  let usedArgs: SongUrlArgs = trackArgs;

  const candidates = await getPrivilegeCandidates(track, quality);
  let trialCandidate: { outcome: SongUrlOutcome; args: SongUrlArgs } | null = null;
  for (const candidate of candidates) {
    const probed = await requestSongUrl({
      ...trackArgs,
      hash: candidate.hash,
      quality: candidate.quality,
      freePart: false,
      ppageId: DESKTOP_PPAGE_ID,
    });
    if (!probed.urls.length) continue;
    const candidateArgs = { ...trackArgs, hash: candidate.hash };
    // 试听片段先记下、继续试下一档找完整版；都不行再回头用它（历史试听检测不破坏）
    if (isTrialOutcome(probed, track)) {
      if (!trialCandidate) trialCandidate = { outcome: probed, args: candidateArgs };
      continue;
    }
    outcome = probed;
    usedArgs = candidateArgs;
    break;
  }
  if (!outcome && trialCandidate) {
    outcome = trialCandidate.outcome;
    usedArgs = trialCandidate.args;
  }

  // 逐档都没拿到：再退回试听片段（IsFreePart:1），至少保证有部分可听。
  if (!outcome) {
    outcome = await requestSongUrl({ ...trackArgs, quality, freePart: true, ppageId: DESKTOP_PPAGE_ID });
    if (outcome.urls.length) usedArgs = trackArgs;
  }

  // 仍一无所获：用「歌手 + 歌名」搜索换标准 hash 再走一轮完整版取链（保留原有换源能力）。
  if (!outcome.urls.length) {
    const replacement = await findSearchReplacement(track);
    if (replacement) {
      const rep = await requestSongUrl({ ...replacement, quality, freePart: false, ppageId: DESKTOP_PPAGE_ID });
      if (!rep.urls.length && quality !== '128') {
        // 换源后再降标准音质试一次
        outcome = await requestSongUrl({ ...replacement, quality: '128', freePart: false, ppageId: DESKTOP_PPAGE_ID });
        if (outcome.urls.length) usedArgs = replacement;
      } else {
        outcome = rep;
      }
      if (outcome.urls.length) usedArgs = replacement;
    }
  }

  // 兜底拿完整版。两种情形都要触发：
  //  1) 酷狗完全取不到 URL（无版权 / VIP / 风控）；
  //  2) 只拿到试听片段——非会员时酷狗会返回 30~90 秒的试听 URL，"有 URL"不等于完整源，
  //     若当成成功直接播放，用户听到一半就断，兜底等于没加。
  const resolvedDuration = normalizeDurationMs(outcome.timeLength);
  const isTrialOnly = isTrialOutcome(outcome, track);
  const needFallback = !outcome.urls.length || isTrialOnly;

  if (needFallback && getAltSourceFallback()) {
    try {
      const altUrl = await resolveAltPlaybackUrl(track.title, track.artist);
      return {
        uri: altUrl,
        durationMs: track.durationMs ?? 0,
        fromAltSource: true,
      };
    } catch {
      // 兜底失败：沿用酷狗结果（试听片段照常可听），或走下面的错误提示。
    }
  }

  if (!outcome.urls.length) {
    if (outcome.status === 3) {
      throw new PlaybackUnavailableError('这首歌暂无版权，无法播放');
    }
    throw new PlaybackUnavailableError('这首歌需要 VIP，暂时无法播放');
  }

  return {
    uri: outcome.urls[0],
    bitrate: typeof outcome.bitrate === 'number' ? outcome.bitrate : undefined,
    durationMs: resolvedDuration || track.durationMs || 0,
    hash: usedArgs.hash,
    albumAudioId: pickStringLike(usedArgs.album_audio_id) || undefined,
  };
}

/** 云盘歌曲的播放地址走 mcloud 专用接口。 */
async function resolveCloudSource(track: PlayerTrack): Promise<ResolvedSongSource> {
  const response = await mobileApi.user_cloud_url({
    hash: track.hash,
    album_audio_id: track.albumAudioId ?? 0,
    name: track.title,
  });

  const body = toRecord(response.body);
  const data = toRecord(body.data);
  const urls = collectUrls(data.url);

  if (Number(body.status ?? 0) !== 1 || !urls.length) {
    throw new PlaybackUnavailableError('云盘歌曲暂时无法播放');
  }

  return {
    uri: urls[0],
    durationMs: track.durationMs ?? 0,
  };
}
