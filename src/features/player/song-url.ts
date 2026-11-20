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
};

type SongUrlOutcome = {
  status: number;
  urls: string[];
  timeLength: unknown;
  bitrate: unknown;
};

async function requestSongUrl(args: SongUrlArgs): Promise<SongUrlOutcome> {
  try {
    const response = await mobileApi.song_url({
      hash: args.hash,
      album_id: args.album_id,
      album_audio_id: args.album_audio_id,
      quality: args.quality,
      free_part: args.freePart ? 1 : 0,
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
    };
  } catch {
    // 传输层失败（网关 status=0 / 网络抖动 / SSA 风控）时，底层 reject 的是
    // 非 Error 的 {status, body, cookie} 对象。若放任抛出，会绕过试听回退、
    // 音质降级、换源、备用音源整条兜底链，最终只显示通用「播放失败」文案。
    // 这里转成「没拿到链接」的空 outcome，让上层继续按既有顺序兜底。
    return { status: 0, urls: [], timeLength: undefined, bitrate: undefined };
  }
}

/**
 * 会员账号应拿到完整音源：先按完整版（IsFreePart:0）请求；
 * 拿不到链接时再退回试听片段，避免把原本还能试听的歌变成完全不能播。
 * 判断只看 URL 是否拿到，status 交给上层按最后结果解释。
 */
async function requestSongUrlPreferFull(args: SongUrlArgs): Promise<SongUrlOutcome> {
  const full = await requestSongUrl({ ...args, freePart: false });
  if (full.urls.length) return full;
  return requestSongUrl({ ...args, freePart: true });
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
  let outcome = await requestSongUrlPreferFull({ ...trackArgs, quality });
  let usedArgs = trackArgs;

  if (!outcome.urls.length && quality !== '128') {
    // 高清/无损大概率因会员限制取不到，先退回标准音质再试。
    outcome = await requestSongUrlPreferFull(trackArgs);
  }

  if (!outcome.urls.length) {
    const replacement = await findSearchReplacement(track);
    if (replacement) {
      outcome = await requestSongUrlPreferFull(replacement);
      usedArgs = replacement;
    }
  }

  if (!outcome.urls.length) {
    // 酷狗取链全失败（无版权 / VIP）：按开备用音源兜底。
    // 只在开关开启、非云盘歌曲时触发；站点自身失败会写会话记忆，不会每首都重试。
    if (getAltSourceFallback()) {
      try {
        const altUrl = await resolveAltPlaybackUrl(track.title, track.artist);
        return {
          uri: altUrl,
          durationMs: track.durationMs ?? 0,
          fromAltSource: true,
        };
      } catch {
        // 兜底失败：保持原来的错误提示，不影响既有体验。
      }
    }

    if (outcome.status === 3) {
      throw new PlaybackUnavailableError('这首歌暂无版权，无法播放');
    }

    throw new PlaybackUnavailableError('这首歌需要 VIP，暂时无法播放');
  }

  return {
    uri: outcome.urls[0],
    bitrate: typeof outcome.bitrate === 'number' ? outcome.bitrate : undefined,
    durationMs: normalizeDurationMs(outcome.timeLength) || track.durationMs || 0,
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
