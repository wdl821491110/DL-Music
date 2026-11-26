import { File, Paths, DownloadTask } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

const REPO = 'wdl821491110/DL-Music';
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

/**
 * 实测可用的 GitHub 代理节点（按响应速度排序），逐个尝试，全失败回退直链。
 * 代理随时可能失效，所以保留多个 + 直链兜底。
 */
const PROXY_NODES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.icu/',
  'https://gh.acmsz.top/',
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
  /** 0-1，-1 表示无法计算 */
  fraction: number;
  written: number;
  total: number;
};

export type DownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

type ActiveDownload = {
  version: string;
  filePath: string;
  task: DownloadTask | null;
  promise: Promise<DownloadedFile> | null;
  status: DownloadStatus;
  progress: DownloadProgress | null;
  error: string | null;
};

/**
 * 订阅者放在模块级，不挂在 active 上。
 * 之前挂在 active.listeners 上：首次打开升级页时 active 为 null，订阅直接落空，
 * 随后新建的下载任务带的是空 listeners，进度/完成/错误都通知不到页面 —— 表现为
 * 点了「下载更新」界面毫无反应。这里改成全局订阅，任何时候订阅都有效。
 */
const downloadListeners = new Set<() => void>();

/**
 * 模块级单例：下载任务不绑在页面 state 上。
 * 切后台 / 页面重挂载时，页面重新订阅同一个任务，进度接着走，不会重新下载。
 */
let active: ActiveDownload | null = null;

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

/** API 检查单次请求超时：弱网/蜂窝下 api.github.com 常挂死，必须兜底，否则按钮永久停在"检查中"。 */
const API_TIMEOUT_MS = 12_000;

/** 单节点下载停滞超时：这么久没有任何进度就判定卡死，取消后自动切下一个节点。 */
const DOWNLOAD_STALL_MS = 20_000;

/** 更新检查可用的 GitHub API 代理（实测 gh-proxy.com 可用），全失败再回退直链。 */
const API_PROXY_NODES = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
];

async function fetchReleaseFrom(url: string): Promise<LatestRelease> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`检查更新失败（${response.status}）`);
    const data: any = await response.json();
    if (!data || typeof data !== 'object') throw new Error('检查更新失败（返回异常）');
    const assets = Array.isArray(data.assets) ? data.assets : [];
    return {
      version: String(data.tag_name ?? ''),
      notes: String(data.body ?? ''),
      ipaUrl: assets.find((a: any) => /\.ipa$/i.test(a.name))?.browser_download_url,
      apkUrl: assets.find((a: any) => /\.apk$/i.test(a.name))?.browser_download_url,
      publishedAt: String(data.published_at ?? ''),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 从 GitHub Releases API 拉取最新发布信息：代理优先、直链兜底，逐个带超时。 */
export async function fetchLatestRelease(): Promise<LatestRelease> {
  const rawPath = `repos/${REPO}/releases/latest`;
  const urls = [
    ...API_PROXY_NODES.map((node) => `${node}https://api.github.com/${rawPath}`),
    API_LATEST,
  ];
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await fetchReleaseFrom(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('检查更新失败，请稍后重试');
}

export function pickAssetUrl(info: LatestRelease): string | undefined {
  return Platform.OS === 'ios' ? info.ipaUrl : info.apkUrl;
}

function fileNameFor(version: string): string {
  return `DL-Music-${version}.${Platform.OS === 'ios' ? 'ipa' : 'apk'}`;
}

/** 订阅下载状态变化（模块级，与 active 是否创建无关），返回取消订阅函数。 */
export function subscribeDownload(listener: () => void): () => void {
  downloadListeners.add(listener);
  return () => { downloadListeners.delete(listener); };
}

function emitChange() {
  downloadListeners.forEach((l) => l());
}

export type DownloadSnapshot = {
  status: DownloadStatus;
  progress: DownloadProgress | null;
  version: string | null;
  error: string | null;
};

/** 读取当前下载状态快照（供页面渲染）。 */
export function getDownloadSnapshot(): DownloadSnapshot {
  if (!active) return { status: 'idle', progress: null, version: null, error: null };
  return {
    status: active.status,
    progress: active.progress,
    version: active.version,
    error: active.error,
  };
}

/**
 * 启动下载（幂等）：同一版本已在下载/已完成则直接复用，不重启。
 * 依次尝试代理 + 直链，任一成功即用。用 DownloadTask（可恢复 + 后台 session）。
 */
export function startDownload(version: string, rawUrl: string): void {
  if (
    active &&
    active.version === version &&
    (active.status === 'downloading' || active.status === 'done')
  ) {
    return;
  }
  if (active) {
    try { active.task?.cancel(); } catch { /* ignore */ }
    active = null;
  }

  const dest = new File(Paths.cache, fileNameFor(version));
  const urls = [...PROXY_NODES.map((node) => `${node}${rawUrl}`), rawUrl];

  const session: ActiveDownload = {
    version,
    filePath: dest.uri,
    task: null,
    promise: null,
    status: 'downloading',
    progress: null,
    error: null,
  };
  active = session;
  // 立即通知，按钮立刻从「下载更新」变「下载中…」，杜绝「点了没反应」
  emitChange();

  const run = async (): Promise<DownloadedFile> => {
    let lastError: unknown;
    for (const url of urls) {
      if (active !== session) throw new Error('下载已取消');
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      let task: DownloadTask | null = null;
      try {
        if (dest.exists) await dest.delete();
        // 停滞看门狗：20 秒无任何进度则取消当前任务、切下一个节点，避免永久卡死
        const armWatchdog = () => {
          if (watchdog) clearTimeout(watchdog);
          watchdog = setTimeout(() => {
            try { task?.cancel(); } catch { /* ignore */ }
          }, DOWNLOAD_STALL_MS);
        };
        task = File.createDownloadTask(url, dest, {
          sessionType: 'background',
          onProgress: ({ bytesWritten, totalBytes }) => {
            if (active !== session) return;
            armWatchdog();
            session.progress = {
              fraction: totalBytes > 0 ? bytesWritten / totalBytes : -1,
              written: bytesWritten,
              total: totalBytes,
            };
            emitChange();
          },
        });
        session.task = task;
        armWatchdog();
        const file = await task.downloadAsync();
        if (watchdog) clearTimeout(watchdog);
        if (!file) throw new Error('下载被暂停或连接超时');
        session.status = 'done';
        session.progress = { fraction: 1, written: 1, total: 1 };
        emitChange();
        return file;
      } catch (error) {
        if (watchdog) clearTimeout(watchdog);
        lastError = error;
        try { if (dest.exists) await dest.delete(); } catch { /* ignore */ }
      }
    }
    session.status = 'error';
    session.error = lastError instanceof Error ? lastError.message : '所有下载节点均失败';
    emitChange();
    throw lastError instanceof Error ? lastError : new Error('所有下载节点均失败');
  };

  // 用 .catch 吞掉未处理的 rejection；错误状态已写进 session.error，页面通过 snapshot 读取
  session.promise = run().catch(() => null as unknown as DownloadedFile);
}

/** 拿到已下载完成的文件（仅 done 状态可用）。 */
export async function getDownloadedFile(): Promise<DownloadedFile | null> {
  if (!active || active.status !== 'done' || !active.promise) return null;
  return active.promise;
}

/** 重置下载状态（关闭弹窗 / 重新开始时调用）。 */
export function resetDownload(): void {
  if (active) {
    try { active.task?.cancel(); } catch { /* ignore */ }
  }
  active = null;
}

/**
 * 安装 / 保存安装包。
 * 安卓：拿 content:// URI 调系统安装器（需 REQUEST_INSTALL_PACKAGES 权限）。
 * iOS：调系统分享面板存到「文件」，用户再签名安装。
 */
export async function installOrSave(version: string): Promise<boolean> {
  const file = await getDownloadedFile();
  if (!file) throw new Error('安装包尚未下载完成');
  const fileName = fileNameFor(version);

  if (Platform.OS === 'android') {
    const contentUri = await getContentUriAsync(file.uri);
    // 必须用显式 ACTION_VIEW + APK mime + 授予 URI 读取权限，否则国产 ROM（vivo/OPPO/小米等）
    // 的 Linking.openURL(contentUri) 会静默失败、拉不起系统安装器。
    // FLAG_GRANT_READ_URI_PERMISSION(1) 让安装器能读这个 content://，
    // FLAG_ACTIVITY_NEW_TASK(0x10000000) 允许从非 Activity 上下文拉起。
    const FLAG_GRANT_READ_URI_PERMISSION = 1;
    const FLAG_ACTIVITY_NEW_TASK = 0x10000000;
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: 'application/vnd.android.package-archive',
        flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
      });
    } catch {
      // 部分 ROM 对显式 mime 的 VIEW 不响应，回退到裸 URI 打开，尽量拉起安装器
      const { Linking } = await import('react-native');
      await Linking.openURL(contentUri);
    }
    return true;
  }

  if (!(await Sharing.isAvailableAsync())) throw new Error('当前系统不支持文件保存');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: `保存 ${fileName}`,
  });
  return false;
}
