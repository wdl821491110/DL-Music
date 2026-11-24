import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, View, XStack, YStack } from 'tamagui';

import { SFIcon } from '@/components/ui/sf-icon';
import { usePalette } from '@/hooks/use-palette';

const LOG_NAME = 'media_diag.log';

export default function MediaDiagnoseScreen() {
  const palette = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<string[]>([]);
  const [stamp, setStamp] = useState('');

  const readLog = useCallback(() => {
    try {
      const f = new File(Paths.document, LOG_NAME);
      if (f.exists) {
        const text = f.text();
        setLines(text.split('\n').filter((l) => l.length > 0));
      } else {
        setLines(['（还没有日志）请先播放一首歌，等几秒，再回来点「刷新」。']);
      }
      setStamp(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    } catch (e) {
      setLines(['读取日志失败：' + String(e)]);
    }
  }, []);

  useEffect(() => {
    readLog();
  }, [readLog]);

  const isAndroid = Platform.OS === 'android';

  return (
    <View flex={1} backgroundColor={palette.background} paddingTop={insets.top}>
      <XStack
        alignItems="center"
        gap={14}
        paddingHorizontal={18}
        paddingVertical={12}
        borderBottomWidth={StyleSheet.hairlineWidth}
        borderBottomColor={palette.border}>
        <XStack
          width={38}
          height={38}
          alignItems="center"
          justifyContent="center"
          backgroundColor={palette.card}
          borderRadius={12}
          pressStyle={{ opacity: 0.7 }}
          onPress={() => router.back()}>
          <SFIcon symbol="chevron.left" fallback="chevron-back" size={20} color={palette.text} />
        </XStack>
        <Text color={palette.text} fontSize={22} fontWeight="800">
          媒体诊断
        </Text>
      </XStack>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 40 }}>
        <YStack gap={14}>
          <Text color={palette.textSecondary} fontSize={13} lineHeight={19}>
            用法：播放一首歌，等 3~5 秒，回到这个页面点「刷新」，然后把整屏截图发给开发者。
          </Text>

          {!isAndroid ? (
            <Text color={palette.textSecondary} fontSize={13}>
              诊断日志仅在 Android 版产生。
            </Text>
          ) : null}

          <XStack gap={10}>
            <XStack
              flex={1}
              height={44}
              alignItems="center"
              justifyContent="center"
              backgroundColor={palette.accent}
              borderRadius={12}
              pressStyle={{ opacity: 0.8 }}
              onPress={readLog}>
              <XStack alignItems="center" gap={6}>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text color="#fff" fontSize={14} fontWeight="700">
                  刷新
                </Text>
              </XStack>
            </XStack>
          </XStack>

          <YStack
            backgroundColor={palette.card}
            borderRadius={16}
            borderWidth={StyleSheet.hairlineWidth}
            borderColor={palette.border}
            padding={14}
            gap={6}>
            <Text color={palette.textTertiary} fontSize={11}>
              日志（更新于 {stamp || '—'}）
            </Text>
            {lines.length === 0 ? (
              <Text color={palette.textSecondary} fontSize={13}>
                加载中…
              </Text>
            ) : (
              lines.map((line, i) => (
                <Text key={i} color={palette.text} fontSize={12} lineHeight={17} selectable>
                  {line}
                </Text>
              ))
            )}
          </YStack>

          <Text color={palette.textTertiary} fontSize={11} lineHeight={16}>
            说明：日志记录了机型、系统版本、通知渠道级别、媒体会话是否建立、系统是否连接媒体控制器、按钮数量。这些信息用于定位锁屏/控制中心按钮不显示的原因。
          </Text>
        </YStack>
      </ScrollView>
    </View>
  );
}
