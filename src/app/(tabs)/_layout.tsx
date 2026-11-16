import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer } from '@/components/ui/mini-player';
import { SFIcon } from '@/components/ui/sf-icon';
import {
  TabBarHeight,
  TabBarSideMargin,
  TabletDockMaxWidth,
  TabletTabBarMaxWidth,
} from '@/constants/layout';
import { useIsTablet } from '@/hooks/use-is-tablet';
import { useIsDark, usePalette } from '@/hooks/use-palette';

type TabGlyph = 'home' | 'compass' | 'person';

// Android 回退用 Ionicons 名；iOS 用原生 SF Symbols
const TAB_SYMBOLS: Record<TabGlyph, { focused: string; idle: string }> = {
  home: { focused: 'house.fill', idle: 'house' },
  compass: { focused: 'safari.fill', idle: 'safari' },
  person: { focused: 'person.fill', idle: 'person' },
};

const USES_LIQUID_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable();

export default function TabsLayout() {
  const palette = usePalette();
  const isDark = useIsDark();
  const isTablet = useIsTablet();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const barHeight = isTablet ? TabBarHeight : TabBarHeight + insets.bottom;

  // 平板：导航条是居中悬浮胶囊，MiniPlayer 悬浮在其上方；手机：沿用全宽底部栏
  const tabBarWidth = isTablet ? Math.min(width - 48, TabletTabBarMaxWidth) : width;
  const tabBarLeft = (width - tabBarWidth) / 2;
  const tabBarBottom = isTablet ? insets.bottom + 10 : 0;

  const dockWidth = Math.min(width - TabBarSideMargin * 2, isTablet ? TabletDockMaxWidth : 680);
  const dockLeft = (width - dockWidth) / 2;
  const dockBottom = tabBarBottom + barHeight + 8;

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: palette.background },
          tabBarShowLabel: true,
          tabBarActiveTintColor: palette.accent,
          tabBarInactiveTintColor: palette.textTertiary,
          tabBarPosition: 'bottom',
          tabBarHideOnKeyboard: true,
          // iOS 26+：系统原生液态玻璃背景；其他平台回退原有材质
          tabBarBackground: () =>
            USES_LIQUID_GLASS ? (
              <GlassView
                glassEffectStyle="regular"
                colorScheme="auto"
                style={[StyleSheet.absoluteFill, { borderRadius: isTablet ? 28 : 0 }]}
              />
            ) : (
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: palette.barSurface }]}
              />
            ),
          tabBarLabelStyle: {
            fontSize: 10.5,
            fontWeight: '600',
          },
          tabBarStyle: {
            position: 'absolute',
            left: tabBarLeft,
            width: tabBarWidth,
            bottom: tabBarBottom,
            height: barHeight,
            borderTopWidth: USES_LIQUID_GLASS ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: USES_LIQUID_GLASS ? undefined : palette.border,
            backgroundColor: USES_LIQUID_GLASS ? 'transparent' : palette.barSurface,
            borderRadius: isTablet ? 28 : 0,
            borderColor: isTablet && !USES_LIQUID_GLASS ? palette.border : undefined,
            borderWidth: isTablet && !USES_LIQUID_GLASS ? StyleSheet.hairlineWidth : 0,
            shadowColor: USES_LIQUID_GLASS ? 'transparent' : palette.dockShadow,
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: USES_LIQUID_GLASS ? 0 : isDark ? 0.45 : 0.08,
            shadowRadius: 22,
            elevation: isTablet ? 12 : 10,
          },
        }}>
        {([
          { name: 'index', title: '首页', glyph: 'home' },
          { name: 'discover', title: '发现', glyph: 'compass' },
          { name: 'me', title: '我的', glyph: 'person' },
        ] as const).map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarIcon: ({ focused, color }) => (
                <SFIcon
                  symbol={
                    focused ? TAB_SYMBOLS[tab.glyph].focused : TAB_SYMBOLS[tab.glyph].idle
                  }
                  fallback={
                    focused
                      ? tab.glyph
                      : (`${tab.glyph}-outline` as const)
                  }
                  size={isTablet ? 25 : 23}
                  color={color}
                />
              ),
            }}
          />
        ))}
      </Tabs>

      {keyboardVisible ? null : (
        <View
          pointerEvents="box-none"
          style={[
            styles.dock,
            {
              bottom: dockBottom,
              left: dockLeft,
              width: dockWidth,
            },
          ]}>
          <MiniPlayer />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  dock: {
    position: 'absolute',
  },
});
