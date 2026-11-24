/**
 * DL Music - Android 媒体通知 / 锁屏 / 控制中心 兼容 patch
 *
 * expo-audio 57.0.5 (media3 1.9.0) 原生实现有三处导致 Android 13+（API 33+，
 * vivo/小米等国产 ROM）锁屏与控制中心「只有歌曲信息、没有控制按钮」：
 *
 *   1) 通知渠道 IMPORTANCE_LOW（静默级），国产 ROM 会降级处理；
 *   2) 显式 addAction 控制按钮只在 API<=32 添加，Android 13+ 完全依赖 PlaybackState；
 *   3) AudioMediaSessionCallback.onConnect 主动 remove 了 SKIP_TO_PREVIOUS/NEXT 命令，
 *      系统按 PlaybackState 算按钮时槽位为空，切歌事件也没接。
 *
 * 构建时在 expo prebuild 之后运行，直接改 node_modules 原生源码：
 *   - AudioControlsService.kt : 渠道 DEFAULT；所有版本加控制按钮；customLayout 加切歌；
 *                                onStartCommand + 常量 + callback 实例化注入 player
 *   - AudioMediaSessionCallback.kt : 恢复 SKIP 命令；onCustomCommand 转发切歌事件给 JS
 *   - MetadataInjectingPlayer.kt : 声明 SKIP 可用命令
 *
 * 幂等：每处用特征串检测，重复运行跳过已应用项。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('node_modules/expo-audio/android/src/main/java/expo/modules/audio');
const SERVICE = path.join(ROOT, 'service/AudioControlsService.kt');
const CALLBACK = path.join(ROOT, 'service/AudioMediaSessionCallback.kt');
const META_PLAYER = path.join(ROOT, 'service/MetadataInjectingPlayer.kt');

for (const f of [SERVICE, CALLBACK, META_PLAYER]) {
  if (!fs.existsSync(f)) throw new Error(`[patch] 找不到 ${f}`);
}

const applied = [];
function edit(file, fn) {
  let s = fs.readFileSync(file, 'utf8');
  const out = fn(s);
  if (out !== s) fs.writeFileSync(file, out, 'utf8');
}

// ============ 1. AudioControlsService.kt ============
edit(SERVICE, (s) => {
  // 1a. 通知渠道 IMPORTANCE_LOW -> IMPORTANCE_DEFAULT（静音）
  const chanRe =
    /NotificationChannel\(\s*CHANNEL_ID,\s*CHANNEL_ID,\s*NotificationManager\.IMPORTANCE_LOW\s*\)/;
  if (s.includes('[DL Music] channel')) {
    applied.push('通知渠道(已)');
  } else if (chanRe.test(s)) {
    s = s.replace(
      chanRe,
      `NotificationChannel(\n            CHANNEL_ID,\n            CHANNEL_ID,\n            NotificationManager.IMPORTANCE_DEFAULT\n          ).apply {\n            setSound(null, null)\n            enableVibration(false)\n          } // [DL Music] channel`
    );
    applied.push('通知渠道');
  } else throw new Error('[patch] 通知渠道目标未找到');

  // 1b. 所有 Android 版本都添加显式控制按钮
  const cond = 'if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {';
  if (s.includes('[DL Music] 所有版本控制按钮')) {
    applied.push('控制按钮(已)');
  } else if (s.includes(cond)) {
    s = s.replace(cond, 'if (true) { // [DL Music] 所有版本控制按钮');
    applied.push('控制按钮');
  } else throw new Error('[patch] 控制按钮判断目标未找到');

  // 1c. customLayout 增加上一首/下一首（media3 常量是 ICON_NEXT / ICON_PREVIOUS）
  if (s.includes('[DL Music] customLayout 切歌')) {
    applied.push('customLayout切歌(已)');
  } else {
    const anchor = '    // Add play/pause button (always present)\n    mediaButtons.add(';
    if (!s.includes(anchor)) throw new Error('[patch] customLayout 锚点未找到');
    const insert = `    // [DL Music] customLayout 切歌：让 Android 13+ 系统渲染上一首/下一首
    mediaButtons.add(
      CommandButton.Builder(CommandButton.ICON_PREVIOUS)
        .setDisplayName("Previous")
        .setEnabled(true)
        .setSessionCommand(SessionCommand(ACTION_PREVIOUS, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_BACK)
        .build()
    )
    mediaButtons.add(
      CommandButton.Builder(CommandButton.ICON_NEXT)
        .setDisplayName("Next")
        .setEnabled(true)
        .setSessionCommand(SessionCommand(ACTION_NEXT, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_FORWARD)
        .build()
    )
${anchor}`;
    s = s.replace(anchor, insert);
    applied.push('customLayout切歌');
  }

  // 1d. 新增 ACTION_NEXT / ACTION_PREVIOUS 常量
  if (s.includes('const val ACTION_NEXT')) {
    applied.push('切歌常量(已)');
  } else {
    const constAnchor = '    const val ACTION_SEEK_FORWARD = "expo.modules.audio.action.SEEK_FORWARD"';
    if (!s.includes(constAnchor)) throw new Error('[patch] 常量锚点未找到');
    s = s.replace(
      constAnchor,
      `    const val ACTION_NEXT = "expo.modules.audio.action.NEXT_TRACK" // [DL Music] 切歌常量
    const val ACTION_PREVIOUS = "expo.modules.audio.action.PREVIOUS_TRACK"
${constAnchor}`
    );
    applied.push('切歌常量');
  }

  // 1e. onStartCommand 处理切歌 action（通知栏点按钮时）
  if (s.includes('[DL Music] onStartCommand 切歌')) {
    applied.push('通知栏切歌(已)');
  } else {
    const actionAnchor =
      '        ACTION_SEEK_FORWARD -> currentPlayerRef.seekTo(currentPlayerRef.currentPosition + SEEK_INTERVAL_MS)';
    if (!s.includes(actionAnchor)) throw new Error('[patch] onStartCommand 锚点未找到');
    s = s.replace(
      actionAnchor,
      `        // [DL Music] onStartCommand 切歌：转发给 JS 播放队列
        ACTION_NEXT, ACTION_PREVIOUS -> {
          val evt = if (intent?.action == ACTION_NEXT) "remoteNextTrack" else "remotePreviousTrack"
          appContext?.reactContext?.runOnUiThread { currentPlayer?.emit(evt) }
        }
${actionAnchor}`
    );
    applied.push('通知栏切歌');
  }

  // 1f. 两处 callback 实例化注入 currentPlayer provider
  const cbNew = 'AudioMediaSessionCallback({ currentPlayer })';
  const cbCount = (s.match(/AudioMediaSessionCallback\(\)/g) || []).length;
  if (cbCount > 0) {
    s = s.replace(/AudioMediaSessionCallback\(\)/g, cbNew);
    applied.push(`callback注入(${cbCount})`);
  } else if (s.includes(cbNew)) {
    applied.push('callback注入(已)');
  }

  return s;
});

// ============ 2. AudioMediaSessionCallback.kt ============
edit(CALLBACK, (s) => {
  // 2a. 构造改为接收 player provider
  if (s.includes('private val activePlayer')) {
    applied.push('callback构造(已)');
  } else {
    s = s.replace(
      'class AudioMediaSessionCallback : MediaSession.Callback {',
      `class AudioMediaSessionCallback(
  private val activePlayer: () -> expo.modules.audio.AudioPlayer? = { null }
) : MediaSession.Callback { // [DL Music] callback构造`
    );
    applied.push('callback构造');
  }

  // 2b. 恢复 SKIP 命令（去掉 4 行 remove）
  if (s.includes('[DL Music] 保留SKIP')) {
    applied.push('SKIP命令(已)');
  } else {
    for (const line of [
      '            .remove(Player.COMMAND_SEEK_TO_NEXT)',
      '            .remove(Player.COMMAND_SEEK_TO_PREVIOUS)',
      '            .remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)',
      '            .remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)',
    ]) {
      if (!s.includes(line)) throw new Error(`[patch] SKIP remove 未找到: ${line}`);
      s = s.replace(line, '            // [DL Music] 保留SKIP');
    }
    // 显式 add，确保 DEFAULT 未包含时也能渲染上一首/下一首
    const seekAnchor = '            .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)';
    if (s.includes(seekAnchor)) {
      s = s.replace(
        seekAnchor,
        `            // [DL Music] 显式声明 SKIP 命令
            .add(Player.COMMAND_SKIP_TO_NEXT)
            .add(Player.COMMAND_SKIP_TO_PREVIOUS)
${seekAnchor}`
      );
    }
    applied.push('SKIP命令');
  }

  // 2c. sessionCommands 增加 NEXT/PREVIOUS
  if (s.includes('ACTION_NEXT, Bundle.EMPTY')) {
    applied.push('session命令(已)');
  } else {
    const anchor = '            .add(SessionCommand(AudioControlsService.ACTION_SEEK_FORWARD, Bundle.EMPTY))';
    if (!s.includes(anchor)) throw new Error('[patch] sessionCommands 锚点未找到');
    s = s.replace(
      anchor,
      `            .add(SessionCommand(AudioControlsService.ACTION_NEXT, Bundle.EMPTY))
            .add(SessionCommand(AudioControlsService.ACTION_PREVIOUS, Bundle.EMPTY))
${anchor}`
    );
    applied.push('session命令');
  }

  // 2d. onCustomCommand 处理切歌 -> emit
  if (s.includes('[DL Music] onCustomCommand 切歌')) {
    applied.push('onCustomCommand(已)');
  } else {
    const anchor = '      AudioControlsService.ACTION_SEEK_FORWARD -> {';
    if (!s.includes(anchor)) throw new Error('[patch] onCustomCommand 锚点未找到');
    s = s.replace(
      anchor,
      `      // [DL Music] onCustomCommand 切歌：转发给 JS 播放队列
      AudioControlsService.ACTION_NEXT -> {
        activePlayer()?.emit("remoteNextTrack")
      }
      AudioControlsService.ACTION_PREVIOUS -> {
        activePlayer()?.emit("remotePreviousTrack")
      }
${anchor}`
    );
    applied.push('onCustomCommand');
  }
  return s;
});

// ============ 3. MetadataInjectingPlayer.kt ============
edit(META_PLAYER, (s) => {
  if (s.includes('[DL Music] 声明SKIP命令')) {
    applied.push('SKIP能力(已)');
  } else {
    const anchor = '  override fun getMediaMetadata(): MediaMetadata {';
    if (!s.includes(anchor)) throw new Error('[patch] MetadataInjectingPlayer 锚点未找到');
    const insert = `  // [DL Music] 声明SKIP命令：让 Android 13+ 按 PlaybackState 渲染上一首/下一首
  override fun getAvailableCommands(): Player.Commands {
    return super.getAvailableCommands().buildUpon()
      .add(Player.COMMAND_SKIP_TO_NEXT)
      .add(Player.COMMAND_SKIP_TO_PREVIOUS)
      .build()
  }

${anchor}`;
    s = s.replace(anchor, insert);
    applied.push('SKIP能力');
  }
  return s;
});

console.log('[patch] expo-audio Android 媒体控制 patch 完成：' + applied.join('、'));
