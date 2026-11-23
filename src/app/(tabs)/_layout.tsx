import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Slot } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from '@/components/ui/mini-player';
import { Sidebar } from '@/components/ui/sidebar';
import { useHasTrack } from '@/features/player/store';
import { TabletDockMaxWidth, SidebarBreakpoint } from '@/constants/layout';
import { usePalette } from '@/hooks/use-palette';

// iOS 26+ 由系统原生 UITabBarController 提供：悬浮液态玻璃胶囊、
// 长按滑动「选择气泡」、下滑收缩成单标签；MiniPlayer 挂系统 bottom accessory。
const IS_IOS = Platform.OS === 'ios';
const IOS_MAJOR = IS_IOS ? parseInt(String(Platform.Version), 10) : 0;
const HAS_NATIVE_ACCESSORY = IS_IOS && IOS_MAJOR >= 26;

export default function TabsLayout() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const hasTrack = useHasTrack();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // 平板：窗口短边 ≥ 阈值，走左侧栏 + 内容区分栏布局（借鉴桌面版）
  const isTablet = Math.min(width, height) >= SidebarBreakpoint;
  const dockWidth = Math.min(width - 48, TabletDockMaxWidth);

  useEffect(() => {
    if (HAS_NATIVE_ACCESSORY) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // ---------- 平板布局 ----------
  if (isTablet) {
    return (
      <View style={[styles.tabletRoot, { backgroundColor: palette.background }]}>
        <Sidebar />
        <View style={styles.tabletContent}>
          <Slot />
        </View>
        {!keyboardVisible && hasTrack ? (
          <View style={styles.tabletDockWrap}>
            <View
              pointerEvents="box-none"
              style={[
                styles.tabletDock,
                {
                  bottom: insets.bottom + 12,
                  width: dockWidth,
                },
              ]}>
              <MiniPlayer />
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  // ---------- 手机布局 ----------
  return (
    <>
      <NativeTabs
        minimizeBehavior="onScrollDown"
        tintColor={palette.accent}
        iconColor={palette.textTertiary}
        labelStyle={{ fontSize: 10.5, fontWeight: '600' }}>
        {HAS_NATIVE_ACCESSORY && hasTrack ? (
          <NativeTabs.BottomAccessory>
            {/* 撑高 accessory 底部，让播放条与悬浮 Tab 栏之间留出间距，避免贴合 */}
            <View style={styles.accessorySpacer}>
              <MiniPlayer />
            </View>
          </NativeTabs.BottomAccessory>
        ) : null}

        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>首页</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'house', selected: 'house.fill' }}
            md={{ default: 'home', selected: 'home' }}
          />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="discover">
          <NativeTabs.Trigger.Label>发现</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'safari', selected: 'safari.fill' }}
            md={{ default: 'explore', selected: 'explore' }}
          />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="me">
          <NativeTabs.Trigger.Label>我的</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'person', selected: 'person.fill' }}
            md={{ default: 'person', selected: 'person' }}
          />
        </NativeTabs.Trigger>
      </NativeTabs>

      {/* iOS 26 以下 / Android：MiniPlayer 仍以悬浮卡片形式显示在 Tab 栏上方 */}
      {!HAS_NATIVE_ACCESSORY && !keyboardVisible && hasTrack ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.dock,
            {
              bottom: insets.bottom + 64 + 8,
              left: 8,
              width: width - 16,
            },
          ]}>
          <MiniPlayer />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  tabletRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  tabletContent: {
    flex: 1,
  },
  tabletDockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  tabletDock: {
    // 由 tabletDockWrap 负责水平居中，这里只管悬浮
  },
  dock: {
    position: 'absolute',
  },
  accessorySpacer: {
    // 系统 bottomAccessory 高度固定、内容 absoluteFill，padding 撑不高容器；
    // 用 transform 纯视觉上移播放条，与悬浮 Tab 栏之间露出间距（不影响布局命中）。
    transform: [{ translateY: -12 }],
  },
});
