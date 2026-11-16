import { Ionicons } from '@expo/vector-icons';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, type ViewStyle } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

type IoniconsName = keyof typeof Ionicons.glyphMap;

type SFIconProps = {
  /** SF Symbols 名称，如 'house.fill'（仅 iOS 生效） */
  symbol: string;
  /** Ionicons 图标名，Android 回退使用 */
  fallback: IoniconsName;
  size?: number;
  color?: string;
  style?: ViewStyle;
};

/**
 * 跨端图标：iOS 渲染原生 SF Symbols，Android 回退 Ionicons。
 * 用法：<SFIcon symbol="play.fill" fallback="play" size={24} color="#FA2D48" />
 */
export function SFIcon({
  symbol,
  fallback,
  size = 24,
  color,
  style,
}: SFIconProps) {
  if (Platform.OS === 'ios') {
    const symbolProps: SymbolViewProps = {
      name: symbol as SFSymbol,
      size,
      tintColor: color,
      weight: 'medium',
    };
    return <SymbolView {...symbolProps} style={[{ width: size, height: size }, style]} />;
  }
  return <Ionicons name={fallback} size={size} color={color} style={style} />;
}
