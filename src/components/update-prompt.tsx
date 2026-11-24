import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import Constants from 'expo-constants';

import { compareVersion, fetchLatestRelease } from '@/lib/updater';

/**
 * 全局更新提醒：挂载时（App 启动）静默检查一次，发现新版本直接弹窗。
 * 用户选「每次启动都提醒」，所以这里不记跳过状态，每次冷启动都检查。
 */
export function UpdatePrompt() {
  const router = useRouter();
  const checked = useRef(false);
  const version = Constants.expoConfig?.version ?? '';

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    // 延迟一点，避免和启动闪屏 / 权限弹窗抢焦点
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const info = await fetchLatestRelease();
          if (!info.version || !version) return;
          if (compareVersion(info.version, version) <= 0) return;

          const notes = info.notes.trim().slice(0, 200) || '查看新版本详情';
          Alert.alert(
            `发现新版本 ${info.version}`,
            `当前版本 v${version}\n\n${notes}`,
            [
              { text: '稍后再说', style: 'cancel' },
              {
                text: '立即升级',
                onPress: () => router.push({ pathname: '/settings', params: { openUpdate: '1' } }),
              },
            ],
            { cancelable: true },
          );
        } catch {
          // 启动检查失败静默处理，不打扰用户；设置页手动检查仍可用
        }
      })();
    }, 1500);

    return () => clearTimeout(timer);
  }, [router, version]);

  return null;
}
