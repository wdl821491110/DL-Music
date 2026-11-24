/**
 * DL Music - 安卓媒体会话诊断补丁（仅诊断，不改任何行为）
 *
 * 在 expo-audio 的 AudioControlsService.kt 关键节点写入诊断日志到 app 私有文件
 * media_diag.log，app 内「媒体诊断」页读取后展示，用户截图即可反馈真实运行状态。
 *
 * 只加日志，不改通知渠道、按钮、MediaSession 的任何逻辑。
 * 幂等：用 [DL Music] diag 特征串检测。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('node_modules/expo-audio/android/src/main/java/expo/modules/audio');
const SERVICE = path.join(ROOT, 'service/AudioControlsService.kt');
if (!fs.existsSync(SERVICE)) throw new Error('[diag] 找不到 AudioControlsService.kt');

let s = fs.readFileSync(SERVICE, 'utf8');
if (s.includes('[DL Music] diag')) {
  console.log('[diag] 诊断日志已注入，跳过');
  process.exit(0);
}

const applied = [];

// 1. 注入 diag 方法（用单引号数组拼接，避开 Kotlin 字符串模板与 JS 模板冲突）
const diagMethod = [
  '  // [DL Music] diag 诊断：把媒体会话真实状态写到私有文件，供 app 诊断页读取',
  '  private fun diag(msg: String) {',
  '    try {',
  '      val f = java.io.File(filesDir, "media_diag.log")',
  '      if (!f.exists()) {',
  '        f.writeText("=== DL Music 媒体诊断 ===\\n机型=" + android.os.Build.MODEL + " 品牌=" + android.os.Build.BRAND + " Android=" + android.os.Build.VERSION.RELEASE + " SDK=" + android.os.Build.VERSION.SDK_INT + "\\n")',
  '      }',
  '      f.appendText(msg + "\\n")',
  '    } catch (_: Exception) {}',
  '  }',
  '',
].join('\n');

const classAnchor = 'class AudioControlsService : MediaSessionService() {';
if (!s.includes(classAnchor)) throw new Error('[diag] class 锚点未找到');
s = s.replace(classAnchor, classAnchor + '\n' + diagMethod);
applied.push('diag方法');

// 2. onCreate：记录渠道实际级别
const onCreateAnchor =
  '    audioManager = getSystemService(AUDIO_SERVICE) as AudioManager\n    createNotificationChannelIfNeeded()';
if (s.includes(onCreateAnchor)) {
  s = s.replace(
    onCreateAnchor,
    onCreateAnchor +
      '\n    diag("onCreate 渠道级别=" + (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).getNotificationChannel(CHANNEL_ID)?.importance)'
  );
  applied.push('onCreate');
}

// 3. onGetSession：系统是否来连接媒体控制器
const getSessionAnchor = [
  '  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {',
  '    return mediaSession',
  '  }',
].join('\n');
if (s.includes(getSessionAnchor)) {
  s = s.replace(
    getSessionAnchor,
    [
      '  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {',
      '    diag("onGetSession 系统连接 pkg=" + controllerInfo.packageName + " session空=" + (mediaSession == null))',
      '    return mediaSession',
      '  }',
    ].join('\n')
  );
  applied.push('onGetSession');
}

// 4. buildNotification：session 状态、metadata、渠道
const buildAnchor = [
  '  private fun buildNotification(): Notification? {',
  '    val session = mediaSession ?: return null',
].join('\n');
if (s.includes(buildAnchor)) {
  s = s.replace(
    buildAnchor,
    [
      '  private fun buildNotification(): Notification? {',
      '    val session = mediaSession ?: run { diag("buildNotification session为空"); return null }',
      '    diag("buildNotification 标题=" + currentMetadata?.title + " 播放中=" + session.player.isPlaying + " 渠道=" + (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).getNotificationChannel(CHANNEL_ID)?.importance)',
    ].join('\n')
  );
  applied.push('buildNotification');
}

// 5. session 建立
const addSessionAnchor = '        addSession(session)\n        mediaSession = session';
if (s.includes(addSessionAnchor)) {
  s = s.replace(
    addSessionAnchor,
    '        diag("session已建立 addSession token=" + session.token)\n' + addSessionAnchor
  );
  applied.push('addSession');
}

// 6. 按钮数量
const layoutAnchor =
  '    session.setCustomLayout(mediaButtons)\n    session.setMediaButtonPreferences(mediaButtons)';
if (s.includes(layoutAnchor)) {
  s = s.replace(
    layoutAnchor,
    layoutAnchor + '\n    diag("setCustomLayout 按钮数=" + mediaButtons.size + " isPlaying=" + isPlaying)'
  );
  applied.push('customLayout');
}

// 7. 前台服务启动
const fgAnchor = [
  '          startForeground(',
  '            notificationId,',
  '            notification,',
  '            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK',
  '          )',
].join('\n');
if (s.includes(fgAnchor)) {
  s = s.replace(fgAnchor, '          diag("startForeground MEDIA_PLAYBACK")\n' + fgAnchor);
  applied.push('foreground');
}

fs.writeFileSync(SERVICE, s, 'utf8');
console.log('[diag] 诊断注入完成：' + applied.join('、'));
