import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text, View } from 'tamagui';

import { SFIcon } from '@/components/ui/sf-icon';
import { usePalette } from '@/hooks/use-palette';

type IoniconsName = keyof typeof Ionicons.glyphMap;

/** 平板左侧导航栏：结构借鉴桌面版 SidebarNavigation，视觉沿用 iOS 设计令牌。 */
export type SidebarItem = {
  /** expo-router 实际路径 */
  href: string;
  label: string;
  symbol: string;
  fallback: IoniconsName;
};

// 使用实际 URL 路径（expo-router 中 (tabs)/index 对应 '/'）
export const SIDEBAR_ITEMS: SidebarItem[] = [
  { href: '/', label: '首页', symbol: 'house.fill', fallback: 'home' },
  { href: '/discover', label: '发现', symbol: 'safari.fill', fallback: 'compass' },
  { href: '/me', label: '我的', symbol: 'person.fill', fallback: 'person' },
  { href: '/cloud', label: '音乐云盘', symbol: 'icloud.fill', fallback: 'cloud' },
  { href: '/recognize', label: '听歌识曲', symbol: 'waveform.path.ecg', fallback: 'mic' },
];

const EXPANDED_WIDTH = 226;
const COLLAPSED_WIDTH = 76;

export function Sidebar() {
  const palette = usePalette();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname === '/(tabs)/index' : pathname.startsWith(href);

  return (
    <View
      style={[
        styles.root,
        {
          width,
          backgroundColor: palette.barSurface,
          borderRightColor: palette.border,
        },
      ]}>
      {/* 顶部：标题 + 折叠按钮 */}
      <View style={styles.topRow}>
        {collapsed ? null : (
          <Text fontSize={15} fontWeight="700" color={palette.text} numberOfLines={1}>
            DL Music
          </Text>
        )}
        <Pressable
          onPress={() => setCollapsed((v) => !v)}
          style={[
            styles.collapseBtn,
            { backgroundColor: collapsed ? palette.card : palette.cardAlt },
          ]}>
          <SFIcon
            symbol={collapsed ? 'sidebar.right' : 'sidebar.left'}
            fallback="menu"
            size={18}
            color={palette.textSecondary}
          />
        </Pressable>
      </View>

      {/* 导航项 */}
      <View style={styles.nav}>
        {SIDEBAR_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Pressable
              key={item.href}
              onPress={() => router.navigate(item.href as any)}
              style={[styles.navItem, active && { backgroundColor: palette.accentSoft }]}>
              <SFIcon
                symbol={item.symbol}
                fallback={item.fallback}
                size={21}
                color={active ? palette.accent : palette.textSecondary}
              />
              {collapsed ? null : (
                <Text
                  fontSize={14}
                  fontWeight={active ? '600' : '400'}
                  color={active ? palette.accent : palette.text}
                  numberOfLines={1}
                  style={styles.navLabel}>
                  {item.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* 底部留白，避免与播放条重叠 */}
      <View style={styles.bottomSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    height: '100%',
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  collapseBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nav: {
    paddingHorizontal: 8,
    gap: 4,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  navLabel: {
    flexShrink: 1,
  },
  bottomSpacer: {
    flex: 1,
  },
});
