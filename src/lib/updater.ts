import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

const REPO = 'wdl821491110/DL-Music';
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

/**
 * 实测可用的 GitHub 代理节点（2026-11-24 用真实 IPA Range 请求验证），按响应速度排序。
 * 下载安装包时逐个尝试，任一成功即用；全部失败再回退 GitHub 直链。
 * 代理随时可能失效，所以保留多个 + 直链兜底，不依赖单一节点。
 */
const PROXY_NODES = [
  'https://gh.acmsz.top/',
  'https://ghfast.top/',
  'https://ghproxy.icu/',
  'https://gh-proxy.com/',
  'https://ghgo.de5.net/',
  'https://gh.dpik.top/',
  'https://cdn.gh-proxy.com/',
  'https://ghfile.geekertao.top/',
  'https://ghproxy.net/',
  'https://github.tbap.top/',
];

export type LatestRelease = {
  version: string;
  notes: string;
  ipaUrl?: string;
  apkUrl?: string;
  publishedAt: string;
};

export type DownloadedFile = InstanceType<typeof File>;

export type DownloadProgress = {
  /** 0-1，-1 表示无法计算（服务器未返回 Content-Length） */
  fraction: number;
  written: number;
  total: number;
};

function normalizeVersion(v: string): string[] {
  return v.replace(/^v/i, '').split(/[.\-+]/).filter(Boolean);
}

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0。 */
export function compareVersion(a: string, b: string): number {
  const aa = normalizeVersion(a);
  const bb = normalizeVersion(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const x = Number(aa[i] ?? 0) || 0;
    const y = Number(bb[i] ?? 0) || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 从 GitHub Releases API 拉取最新发布信息，并挑出当前平台可用的安装包。 */
export async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await fetch(API_LATEST, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`检查更新失败（${response.status}）`);
  const data: any = await response.json();
  const assets = Array.isArray(data.assets) ? data.assets : [];
  return {
    version: String(data.tag_name ?? ''),
    notes: String(data.body ?? ''),
    ipaUrl: assets.find((a: any) => /\.ipa$/i.test(a.name))?.browser_download_url,
    apkUrl: assets.find((a: any) => /\.apk$/i.test(a.name))?.browser_download_url,
    publishedAt: String(data.published_at ?? ''),
  };
}

/** 取当前平台对应的安装包直链。 */
export function pickAssetUrl(info: LatestRelease): string | undefined {
  return Platform.OS === 'ios' ? info.ipaUrl : info.apkUrl;
}

export type DownloadCallbacks = {
  /** 切换节点时回调：第 index 个 / 共 total 个，节点名 label */
  onNode?: (label: string, index: number, total: number) => void;
  /** 下载进度回调 */
  onProgress?: (progress: DownloadProgress) => void;
};

/**
 * 依次用代理 + 直链尝试下载，任一成功即返回 File。
 * 每次尝试前清掉上次的残留文件，避免部分下载被当成成功。
 * onProgress 直接来自 expo-file-system 的真实字节进度。
 */
export async function downloadInstaller(
  rawUrl: string,
  fileName: string,
  callbacks: DownloadCallbacks = {},
): Promise<DownloadedFile> {
  const { onNode, onProgress } = callbacks;
  const candidates = [
    ...PROXY_NODES.map((node) => ({
      label: node.replace(/^https:\/\//, '').replace(/\/$/, ''),
      url: `${node}${rawUrl}`,
    })),
    { label: 'GitHub 直链', url: rawUrl },
  ];
  const dest = new File(Paths.cache, fileName);
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    onNode?.(candidate.label, i + 1, candidates.length);
    try {
      if (dest.exists) await dest.delete();
      await File.downloadFileAsync(candidate.url, dest, {
        onProgress: ({ bytesWritten, totalBytes }) => {
          onProgress?.({
            fraction: totalBytes > 0 ? bytesWritten / totalBytes : -1,
            written: bytesWritten,
            total: totalBytes,
          });
        },
      });
      return dest;
    } catch (error) {
      lastError = error;
    }
  }

  if (dest.exists) {
    try { await dest.delete(); } catch { /* 清理失败可忽略 */ }
  }
  throw lastError instanceof Error ? lastError : new Error('所有下载节点均失败');
}

/** 交给系统面板保存到本地（iOS「存储到文件」/ Android 保存安装包）。 */
export async function saveInstaller(file: DownloadedFile, title: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前系统不支持文件保存');
  await Sharing.shareAsync(file.uri, {
    mimeType:
      Platform.OS === 'ios'
        ? 'application/octet-stream'
        : 'application/vnd.android.package-archive',
    dialogTitle: title,
  });
}
