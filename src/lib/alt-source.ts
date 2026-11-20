/**
 * 备用音源（flac.music.hi.cn）——下载 + 播放取链共用。
 *
 * 该站是聚合站，search 返回上游（网易云/酷我）歌曲 id + time + sign，
 * getUrl 透传这对值换取带时效的 CDN 直链。全部走 fetch，不依赖酷狗签名层。
 *
 * 设计约束：
 * - 按需触发：下载按钮、或播放链路酷狗取链全部失败后才请求，不每首都发。
 * - 反爬：同一关键词短时间内重复请求会返回空 list，失败最多重试 1 次（间隔 2s）。
 *   会话级失败记忆：同一首失败后一段时间内不再请求，避免反复触发风控。
 * - 时间敏感：time/sign 有时效，search 完立刻 getUrl，成功直链不做持久化缓存。
 */

import { toRecord, toRecords, pickText, pickStringLike } from '@/lib/api-parse';
import { stripEmTags, artistMatches } from '@/lib/format';

const BASE_URL = 'https://flac.music.hi.cn';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;

type Quality = {
  bitrate: string;
  format: string;
};

export type AltSong = {
  songid: string;
  time: string;
  sign: string;
  quality: Quality;
};

export class AltSourceError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postAct(act: string, fields: Record<string, string>): Promise<unknown> {
  const body = Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/ajax.php?act=${act}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': USER_AGENT,
        Referer: `${BASE_URL}/`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTitle(value: string): string {
  return stripEmTags(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 从 search 结果里挑最匹配的一首，优先歌手吻合 + 标题完全一致 + 无损档。 */
function pickBestSong(list: unknown[], title: string, artist: string): Record<string, unknown> | null {
  const wantedTitle = normalizeTitle(title);
  const candidates = toRecords(list).filter((item) => {
    const name = normalizeTitle(pickText(item.name, item.songname));
    if (!name) return false;
    // 完全一致，或搜索结果标题包含目标标题（如"晴天 (女声版)"）。
    const titleOk = name === wantedTitle || name.includes(wantedTitle) || wantedTitle.includes(name);
    if (!titleOk) return false;
    if (!artist || artist === '未知歌手') return true;
    const candidateArtist = pickText(item.artist, item.singername);
    return !candidateArtist || artistMatches(candidateArtist, artist);
  });
  if (!candidates.length) return null;

  const score = (item: Record<string, unknown>): number => {
    const name = normalizeTitle(pickText(item.name, item.songname));
    let points = name === wantedTitle ? 4 : 1;
    if (pickText(item.artist).includes(artist)) points += 2;
    if (toRecords(toRecord(item).minfo).some((q) => pickText(q.format) === 'flac')) points += 1;
    return points;
  };
  return candidates.slice().sort((a, b) => score(b) - score(a))[0];
}

/** 选最高音质档：flac > 320 > 128。 */
function pickBestQuality(minfo: unknown[]): Quality | null {
  const qualities = toRecords(minfo)
    .map((item) => ({ bitrate: pickStringLike(item.bitrate), format: pickText(item.format) }))
    .filter((item) => item.bitrate);
  if (!qualities.length) return null;
  return (
    qualities.find((q) => q.format === 'flac') ??
    qualities.find((q) => q.bitrate === '320') ??
    qualities[0]
  );
}

/** 会话级失败记忆：同一首歌失败后不再重复请求，规避站点反爬。key = 归一化歌手+歌名。 */
const failureMemory = new Map<string, number>();
const FAILURE_TTL_MS = 10 * 60 * 1000;

function getFailureKey(title: string, artist: string): string {
  return `${normalizeTitle(artist)}|${normalizeTitle(title)}`;
}

function isRecentlyFailed(key: string): boolean {
  const at = failureMemory.get(key);
  if (at == null) return false;
  if (Date.now() - at < FAILURE_TTL_MS) return true;
  failureMemory.delete(key);
  return false;
}

function rememberFailure(key: string): void {
  failureMemory.set(key, Date.now());
}

/**
 * 搜索并拿到可直接播放/下载的 CDN 直链（flac > 320 > 128 自动降级）。
 * @param title 歌名
 * @param artist 歌手（用于匹配，避免下错翻唱/同名曲）
 * @param respectFailureMemory 是否遵守会话失败记忆；下载按钮为 true，播放兜底为 true
 */
async function resolveAltUrl(
  title: string,
  artist: string,
  respectFailureMemory = true
): Promise<string> {
  const failureKey = getFailureKey(title, artist);
  if (respectFailureMemory && isRecentlyFailed(failureKey)) {
    throw new AltSourceError('备用音源近期匹配失败，已跳过请求');
  }

  let lastError = '未找到匹配的歌曲';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);

    try {
      // 1) 搜索：拿 songid + time + sign（服务端随结果下发，前端只透传）
      const searchResp = toRecord(await postAct('search', {
        platform: 'wyy',
        keyword: artist && artist !== '未知歌手' ? `${artist} ${title}` : title,
        page: '1',
        size: '10',
      }));
      const list = toRecords(toRecord(searchResp.data).list);
      const matched = pickBestSong(list, title, artist);
      if (!matched) {
        lastError = '备用音源未找到这首歌';
        continue;
      }

      const songid = pickStringLike(matched.id);
      const time = pickStringLike(matched.time);
      const sign = pickText(matched.sign);
      const quality = pickBestQuality(toRecords(matched.minfo));
      if (!songid || !time || !sign || !quality) {
        lastError = '备用音源返回的歌曲信息不完整';
        continue;
      }

      // 2) 换直链：time/sign 有时效，拿到后立刻用
      const urlResp = toRecord(await postAct('getUrl', {
        platform: 'wyy',
        songid,
        format: quality.format,
        bitrate: quality.bitrate,
        time,
        sign,
      }));
      const url = pickText(toRecord(urlResp.data).url);
      if (!url) {
        lastError = pickText(urlResp.msg) || '备用音源未返回下载地址';
        continue;
      }

      failureMemory.delete(failureKey);
      return url;
    } catch (error) {
      lastError = error instanceof Error ? error.message : '备用音源请求失败';
    }
  }

  if (respectFailureMemory) rememberFailure(failureKey);
  throw new AltSourceError(lastError);
}

/** 下载按钮用：拿直链存文件。 */
export async function resolveAltDownloadUrl(title: string, artist: string): Promise<string> {
  return resolveAltUrl(title, artist, true);
}

/**
 * 播放兜底用：酷狗取链全失败后调用。
 * 站点失败同样写入会话记忆；被记忆命中时直接抛错（上层会回退到原错误提示）。
 */
export async function resolveAltPlaybackUrl(title: string, artist: string): Promise<string> {
  return resolveAltUrl(title, artist, true);
}
