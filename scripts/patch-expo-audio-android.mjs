/**
 * DL Music - Android 媒体通知 / 锁屏 / 控制中心 切歌 patch
 *
 * 依据 expo-audio 官方新版(SDK58, PR #46020)的实现，把「上一首/下一首」补进 SDK 57：
 *   1) buildNotification : 所有 Android 版本都加显式控制按钮，且 actions 用上一首/播放/下一首
 *   2) updateSessionCustomLayout : customLayout + mediaButtonPreferences 用 ICON_PREVIOUS / ICON_NEXT
 *   3) callback.onConnect : 声明 SEEK_TO_NEXT/PREVIOUS 玩家命令 + NEXT/PREVIOUS session 命令
 *   4) callback.onCustomCommand : 点击切歌 -> emit remoteNextTrack/remotePreviousTrack 给 JS 队列
 *   5) onStartCommand + 常量 : 通知栏按钮点击转发切歌给 JS
 *
 * media3 1.9.0 常量确认：
 *   - 玩家命令：Player.COMMAND_SEEK_TO_NEXT / COMMAND_SEEK_TO_PREVIOUS（无 SKIP_TO_*）
 *   - 图标：CommandButton.ICON_NEXT / ICON_PREVIOUS
 *   - JS 事件：iOS patch 已 emit remoteNextTrack/remotePreviousTrack，store.ts 已监听
 *
 * 幂等：每处特征串检测，重复运行跳过。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('node_modules/expo-audio/android/src/main/java/expo/modules/audio');
const SERVICE = path.join(ROOT, 'service/AudioControlsService.kt');
const CALLBACK = path.join(ROOT, 'service/AudioMediaSessionCallback.kt');

for (const f of [SERVICE, CALLBACK]) {
  if (!fs.existsSync(f)) throw new Error(`[patch] 找不到 ${f}`);
}

const applied = [];
function edit(file, fn) {
  const s = fs.readFileSync(file, 'utf8');
  const out = fn(s);
  if (out !== s) fs.writeFileSync(file, out, 'utf8');
}

// ============ 1. AudioControlsService.kt ============
edit(SERVICE, (s) => {
  // 1a. 所有 Android 版本都添加显式通知按钮（国产 ROM 锁屏/控制中心主要读 notification actions）
  const cond = 'if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {';
  if (s.includes('[DL Music] 全版本控制按钮')) {
    applied.push('全版本按钮(已)');
  } else if (s.includes(cond)) {
    s = s.replace(cond, 'if (true) { // [DL Music] 全版本控制按钮');
    applied.push('全版本按钮');
  } else throw new Error('[patch] 全版本按钮判断目标未找到');

  // 1b. notification actions：在 seekBackward 之前插入「上一首」，在 seekForward 之后插入「下一首」
  //     把快进快退替换为切歌（用户已关闭 showSeek，两侧 slot 空着）
  if (s.includes('[DL Music] notification 切歌')) {
    applied.push('notification切歌(已)');
  } else {
    // 上一首：插在 seekBackward action 块之前
    const backAnchor =
      '      if (currentOptions?.showSeekBackward == true) {\n        builder.addAction(';
    if (!s.includes(backAnchor)) throw new Error('[patch] notification 上一首锚点未找到');
    s = s.replace(
      backAnchor,
      `      // [DL Music] notification 切歌：上一首（系统媒体卡片 SLOT_BACK）
      builder.addAction(
        NotificationCompat.Action(
          androidx.media3.session.R.drawable.media3_icon_previous,
          "Previous",
          buildActionPendingIntent(ACTION_PREVIOUS)
        )
      )
      compactViewIndices.add(currentIndex)
      currentIndex++
${backAnchor}`
    );
    // 下一首：插在 seekForward action 块之后（在 setShowActionsInCompactView 之前）
    const endAnchor = '      style.setShowActionsInCompactView(*compactViewIndices.toIntArray())';
    if (!s.includes(endAnchor)) throw new Error('[patch] notification 下一首锚点未找到');
    s = s.replace(
      endAnchor,
      `      // [DL Music] notification 切歌：下一首（系统媒体卡片 SLOT_FORWARD）
      builder.addAction(
        NotificationCompat.Action(
          androidx.media3.session.R.drawable.media3_icon_next,
          "Next",
          buildActionPendingIntent(ACTION_NEXT)
        )
      )
      compactViewIndices.add(currentIndex)
${endAnchor}`
    );
    applied.push('notification切歌');
  }

  // 1c. customLayout / mediaButtonPreferences：SLOT_BACK/SLOT_FORWARD 用切歌图标
  if (s.includes('[DL Music] customLayout 切歌')) {
    applied.push('customLayout切歌(已)');
  } else {
    // 替换快退按钮块 -> 上一首
    const backBlock =
      /    \/\/ Add seek backward button if enabled\n    if \(currentOptions\?\.showSeekBackward == true\) \{[\s\S]*?\n    \}\n\n/;
    if (!backBlock.test(s)) throw new Error('[patch] customLayout 快退块未找到');
    s = s.replace(
      backBlock,
      `    // [DL Music] customLayout 切歌：上一首
    mediaButtons.add(
      CommandButton.Builder(CommandButton.ICON_PREVIOUS)
        .setDisplayName("Previous")
        .setEnabled(true)
        .setSessionCommand(SessionCommand(ACTION_PREVIOUS, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_BACK)
        .build()
    )

`
    );
    // 替换快进按钮块 -> 下一首
    const fwdBlock =
      /    \/\/ Add seek forward button if enabled\n    if \(currentOptions\?\.showSeekForward == true\) \{[\s\S]*?\n    \}\n/;
    if (!fwdBlock.test(s)) throw new Error('[patch] customLayout 快进块未找到');
    s = s.replace(
      fwdBlock,
      `    // [DL Music] customLayout 切歌：下一首
    mediaButtons.add(
      CommandButton.Builder(CommandButton.ICON_NEXT)
        .setDisplayName("Next")
        .setEnabled(true)
        .setSessionCommand(SessionCommand(ACTION_NEXT, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_FORWARD)
        .build()
    )
`
    );
    applied.push('customLayout切歌');
  }

  // 1d. 新增 ACTION_NEXT / ACTION_PREVIOUS 常量
  if (s.includes('const val ACTION_NEXT ')) {
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

  // 1e. onStartCommand 处理切歌 action -> emit 给 JS
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

  // 1f. callback 实例化注入 currentPlayer provider
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
  // 2a. 构造接收 player provider
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

  // 2b. onConnect：去掉 remove 切歌命令，显式 add 正确的 SEEK_TO 常量
  if (s.includes('[DL Music] 保留切歌命令')) {
    applied.push('玩家命令(已)');
  } else {
    for (const line of [
      '            .remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)',
      '            .remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)',
      '            .remove(Player.COMMAND_SEEK_TO_PREVIOUS)',
      '            .remove(Player.COMMAND_SEEK_TO_NEXT)',
    ]) {
      if (!s.includes(line)) throw new Error(`[patch] remove 未找到: ${line}`);
      s = s.replace(line, '            // [DL Music] 保留切歌命令');
    }
    // 显式声明切歌命令（media3 1.9.0 正确常量）
    const seekAnchor = '            .add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)';
    if (s.includes(seekAnchor)) {
      s = s.replace(
        seekAnchor,
        `            // [DL Music] 显式声明切歌命令
            .add(Player.COMMAND_SEEK_TO_NEXT)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS)
            .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
${seekAnchor}`
      );
    }
    applied.push('玩家命令');
  }

  // 2c. sessionCommands 增加 NEXT/PREVIOUS
  if (s.includes('AudioControlsService.ACTION_NEXT, Bundle.EMPTY')) {
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

  // 2d. onCustomCommand 处理切歌 -> emit 给 JS
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

console.log('[patch] expo-audio Android 切歌 patch 完成：' + applied.join('、'));
