import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Android 13+（API 33+）起，媒体播放的前台服务通知必须拿到 POST_NOTIFICATIONS
 * 权限，否则通知栏 / 锁屏 / 控制中心 / 厂商「灵动岛」都不会显示播放信息。
 * 在应用启动时申请一次即可；iOS 无需此权限，直接跳过。
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  // Android 13 以下系统自动授予，无需申请
  const version = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (version < 33) return true;

  try {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
