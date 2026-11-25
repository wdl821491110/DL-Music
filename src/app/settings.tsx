import { Ionicons } from '@expo/vector-icons';
import { SFIcon } from '@/components/ui/sf-icon';
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, View, XStack, YStack, Switch } from 'tamagui';

import { SectionHeader } from '@/components/ui/section-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ACCENT_PRESETS, getPalette, type AccentPreset } from '@/constants/accents';
import { MaxContentWidth, type SchemeName } from '@/constants/theme';
import { isLoggedIn } from '@/features/account/user-api';
import { libraryActions } from '@/features/library/store';
import { playerActions } from '@/features/player/store';
import {
  settingsActions,
  useSettings,
  type LyricAlign,
  type LyricFontSize,
  type LyricTranslationFontSize,
  type QualityId,
  type ThemeMode,
} from '@/features/settings/store';
import { useEffectiveScheme, usePalette } from '@/hooks/use-palette';
import { showToast } from '@/components/ui/toast';
import { clearApiSession } from '@/lib/kugou-api';
import {
  compareVersion,
  fetchLatestRelease,
  getDownloadSnapshot,
  installOrSave,
  pickAssetUrl,
  resetDownload,
  startDownload,
  subscribeDownload,
  type DownloadSnapshot,
  type LatestRelease,
} from '@/lib/updater';

const THEME_MODE_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const satisfies readonly { value: ThemeMode; label: string }[];

const LYRIC_ALIGN_OPTIONS = [
  { value: 'center', label: '居中对齐' },
  { value: 'left', label: '左对齐' },
] as const satisfies readonly { value: LyricAlign; label: string }[];

const LYRIC_FONT_OPTIONS = [
  { value: '18', label: '小' },
  { value: '22', label: '标准' },
  { value: '26', label: '大' },
] as const satisfies readonly { value: string; label: string }[];

const LYRIC_TRANSLATION_FONT_OPTIONS = [
  { value: '13', label: '小' },
  { value: '15', label: '标准' },
  { value: '18', label: '大' },
] as const satisfies readonly { value: string; label: string }[];

const QUALITY_OPTIONS = [
  { value: '128', label: '标准' },
  { value: '320', label: '高清' },
  { value: 'flac', label: '无损' },
] as const satisfies readonly { value: QualityId; label: string }[];

const REPO_URL = 'https://github.com/wdl821491110/DL-Music';
const DISCLAIMER = [
  '0. 本程序是酷狗第三方客户端，并非酷狗官方，需要更完善的功能请下载官方客户端体验.',
  '1. 本项目仅供学习使用，请尊重版权，请勿利用此项目从事商业行为及非法用途！',
  '2. 使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在 24 小时内清除使用本项目的过程中所产生的版权数据。',
  '3.由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害（包括但不限于因商誉损失、停工、计算机故障或故障引起的损害赔偿，或任何及所有其他商业损害或损失）由使用者负责。',
  '4. 禁止在违反当地法律法规的情况下使用本项目。对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担，本项目不承担由此造成的任何直接、间接、特殊、偶然或结果性责任。',
  '5. 音乐平台不易，请尊重版权，支持正版。',
  '6. 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。',
  '7. 如果官方音乐平台觉得本项目不妥，可联系本项目更改或移除。',
];

function formatBytes(bytes: number): string {
  if (bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AccentSwatch({
  preset,
  scheme,
  active,
  onPress,
}: {
  preset: AccentPreset;
  scheme: SchemeName;
  active: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const presetPalette = getPalette(preset.id, scheme);

  return (
    <YStack
      alignItems="center"
      gap={6}
      transition="quickest"
      pressStyle={{ opacity: 0.7 }}
      onPress={onPress}>
      <View
        width={44}
        height={44}
        borderRadius={22}
        borderWidth={2}
        borderColor={active ? presetPalette.accent : 'transparent'}
        alignItems="center"
        justifyContent="center">
        <View
          width={34}
          height={34}
          borderRadius={17}
          backgroundColor={presetPalette.accent}
          alignItems="center"
          justifyContent="center">
          {active ? (
            <SFIcon symbol="checkmark" fallback="checkmark" size={18} color={presetPalette.onAccent} />
          ) : null}
        </View>
      </View>
      <Text
        color={active ? palette.text : palette.textTertiary}
        fontSize={10.5}
        fontWeight={active ? '700' : '500'}>
        {preset.label}
      </Text>
    </YStack>
  );
}

function SettingsRow({
  label,
  value,
  danger,
  icon,
  onPress,
}: {
  label: string;
  value?: string;
  danger?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  const palette = usePalette();

  return (
    <XStack
      alignItems="center"
      height={48}
      paddingHorizontal={14}
      gap={10}
      transition="quickest"
      pressStyle={onPress ? { opacity: 0.65, backgroundColor: palette.cardAlt } : undefined}
      onPress={onPress}>
      <Text
        flex={1}
        color={danger ? palette.danger : palette.text}
        fontSize={14.5}
        fontWeight={danger ? '600' : '500'}
        textAlign={danger && !value && !icon ? 'center' : undefined}>
        {label}
      </Text>
      {value ? (
        <Text color={palette.textTertiary} fontSize={13}>
          {value}
        </Text>
      ) : null}
      {icon ? (
        icon === 'logo-github' ? (
          <Ionicons name={icon} size={18} color={palette.textTertiary} />
        ) : (
          <SFIcon
            symbol={icon === 'globe-outline' ? 'globe' : 'info.circle'}
            fallback={icon}
            size={18}
            color={palette.textTertiary}
          />
        )
      ) : null}
    </XStack>
  );
}

export default function SettingsScreen() {
  const palette = usePalette();
  const scheme = useEffectiveScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    themeMode,
    accentId,
    lyricAlign,
    lyricFontSize,
    lyricTranslationFontSize,
    quality,
    animationsEnabled,
    showLyricTranslation,
    altSourceFallback,
  } = useSettings();
  const params = useLocalSearchParams<{ openUpdate?: string }>();
  const [loggedIn, setLoggedIn] = useState(() => isLoggedIn());
  const [aboutVisible, setAboutVisible] = useState(false);
  const [updateVisible, setUpdateVisible] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<LatestRelease | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [snap, setSnap] = useState<DownloadSnapshot>(() => getDownloadSnapshot());
  const autoChecked = useRef(false);
  const version = Constants.expoConfig?.version ?? '';

  function openWeb(url: string, title: string) {
    router.push({ pathname: '/web', params: { url, title } });
  }

  /** 只做检查：拉版本信息，判断是否有更新。是否弹窗由调用方决定。 */
  async function checkUpdate(): Promise<LatestRelease | null> {
    if (checkingUpdate) return null;
    setCheckingUpdate(true);
    try {
      const info = await fetchLatestRelease();
      if (!info.version) throw new Error('未获取到版本信息');
      setUpdateInfo(info);
      const newer = !!version && compareVersion(info.version, version) > 0;
      setHasUpdate(newer);
      return info;
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '检查更新失败，请稍后再试');
      return null;
    } finally {
      setCheckingUpdate(false);
    }
  }

  // 从启动弹窗「立即升级」跳进来时，自动打开升级弹窗并执行检查步骤
  useEffect(() => {
    if (params.openUpdate === '1' && !autoChecked.current) {
      autoChecked.current = true;
      setUpdateVisible(true);
      void checkUpdate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.openUpdate]);

  // 订阅模块级下载任务：切后台 / 页面重挂载都能接着看进度，不会重新下载
  useEffect(() => {
    const off = subscribeDownload(() => setSnap(getDownloadSnapshot()));
    setSnap(getDownloadSnapshot());
    return off;
  }, []);

  /** 第 1 步：点「检查更新」，只检查不下载。 */
  function handleCheckClick() {
    void checkUpdate();
  }

  /** 第 2 步：点「下载更新」，交给模块级任务；完成后自动调安装 / 保存。 */
  async function handleDownloadUpdate() {
    if (!updateInfo || snap.status === 'downloading') return;
    const url = pickAssetUrl(updateInfo);
    if (!url) {
      showToast('当前平台暂无可下载的安装包');
      return;
    }
    startDownload(updateInfo.version, url);
  }

  // 下载完成 → 自动安装（安卓）/ 打开文件保存面板（iOS）
  const handledDone = useRef<string | null>(null);
  useEffect(() => {
    if (snap.status !== 'done' || !snap.version || handledDone.current === snap.version) return;
    handledDone.current = snap.version;
    void (async () => {
      setInstalling(true);
      try {
        const opened = await installOrSave(snap.version!);
        showToast(opened ? '正在打开安装器' : '安装包已保存到本地');
      } catch (cause) {
        showToast(cause instanceof Error ? cause.message : '安装失败，请在文件管理器中手动打开');
      } finally {
        setInstalling(false);
      }
    })();
  }, [snap.status, snap.version]);

  function openUpdateModal() {
    handledDone.current = null;
    setUpdateVisible(true);
  }

  function closeUpdateModal() {
    if (snap.status === 'downloading') return;
    setUpdateVisible(false);
  }

  function confirmLogout() {
    Alert.alert('退出登录', '将清除本机保存的登录信息', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await clearApiSession();
            libraryActions.reset();
            setLoggedIn(false);
          })();
        },
      },
    ]);
  }

  return (
    <View flex={1} backgroundColor={palette.background}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <YStack
          alignSelf="center"
          width="100%"
          maxWidth={MaxContentWidth}
          paddingHorizontal={16}
          paddingTop={insets.top + 10}
          gap={18}>
          <XStack alignItems="center" gap={12}>
            <XStack
              width={38}
              height={38}
              borderRadius={19}
              alignItems="center"
              justifyContent="center"
              backgroundColor={palette.card}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor={palette.border}
              transition="quickest"
              pressStyle={{ opacity: 0.7, scale: 0.96 }}
              onPress={() => router.back()}>
              <SFIcon symbol="chevron.left" fallback="chevron-back" size={20} color={palette.text} />
            </XStack>
            <Text color={palette.text} fontSize={26} fontWeight="800" letterSpacing={0.3}>
              设置
            </Text>
          </XStack>

          <YStack gap={10}>
            <SectionHeader title="外观" />
            <YStack
              backgroundColor={palette.card}
              borderRadius={20}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor={palette.border}
              padding={14}
              gap={14}>
              <YStack gap={10}>
                <Text color={palette.textSecondary} fontSize={13} fontWeight="600">
                  深色模式
                </Text>
                <SegmentedControl
                  options={THEME_MODE_OPTIONS}
                  value={themeMode}
                  onChange={settingsActions.setThemeMode}
                />
              </YStack>
              <View height={StyleSheet.hairlineWidth} backgroundColor={palette.border} />
              <XStack alignItems="center" gap={12}>
                <YStack flex={1} gap={2}>
                  <Text color={palette.text} fontSize={14.5} fontWeight="600">
                    动画效果
                  </Text>
                  <Text color={palette.textTertiary} fontSize={11.5} lineHeight={16}>
                    关闭后界面过渡即时切换，滚动与按压更省电
                  </Text>
                </YStack>
                <Switch
                  size="$2"
                  checked={animationsEnabled}
                  onCheckedChange={(checked) => settingsActions.setAnimationsEnabled(checked)}
                  backgroundColor={animationsEnabled ? palette.accent : palette.cardAlt}
                  borderWidth={0}>
                  <Switch.Thumb backgroundColor="#FFFFFF" />
                </Switch>
              </XStack>
              <View height={StyleSheet.hairlineWidth} backgroundColor={palette.border} />
              <YStack gap={12}>
                <Text color={palette.textSecondary} fontSize={13} fontWeight="600">
                  主题色
                </Text>
                <XStack flexWrap="wrap" gap={14} justifyContent="flex-start">
                  {ACCENT_PRESETS.map((preset) => (
                    <AccentSwatch
                      key={preset.id}
                      preset={preset}
                      scheme={scheme}
                      active={preset.id === accentId}
                      onPress={() => settingsActions.setAccentId(preset.id)}
                    />
                  ))}
                </XStack>
              </YStack>
            </YStack>
          </YStack>

          <YStack gap={10}>
            <SectionHeader title="播放与歌词" />
            <YStack
              backgroundColor={palette.card}
              borderRadius={20}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor={palette.border}
              padding={14}
              gap={14}>
              <YStack gap={10}>
                <Text color={palette.textSecondary} fontSize={13} fontWeight="600">
                  播放音质
                </Text>
                <SegmentedControl
                  options={QUALITY_OPTIONS}
                  value={quality}
                  onChange={(next) => void playerActions.applyQuality(next as QualityId)}
                />
                {quality === 'flac' ? (
                  <Text color={palette.textTertiary} fontSize={11}>
                    无损音质需要酷狗会员，取不到时会自动回退到较低音质
                  </Text>
                ) : null}
              </YStack>
              <View height={StyleSheet.hairlineWidth} backgroundColor={palette.border} />
              <XStack alignItems="center" gap={12}>
                <YStack flex={1} gap={2}>
                  <Text color={palette.text} fontSize={14.5} fontWeight="600">
                    无版权自动换源
                  </Text>
                  <Text color={palette.textTertiary} fontSize={11.5} lineHeight={16}>
                    酷狗无版权或需 VIP 时，自动尝试备用音源播放
                  </Text>
                </YStack>
                <Switch
                  size="$2"
                  checked={altSourceFallback}
                  onCheckedChange={(checked) => settingsActions.setAltSourceFallback(checked)}
                  backgroundColor={altSourceFallback ? palette.accent : palette.cardAlt}
                  borderWidth={0}>
                  <Switch.Thumb backgroundColor="#FFFFFF" />
                </Switch>
              </XStack>
              <View height={StyleSheet.hairlineWidth} backgroundColor={palette.border} />
              <YStack gap={10}>
                <Text color={palette.textSecondary} fontSize={13} fontWeight="600">
                  歌词对齐
                </Text>
                <SegmentedControl
                  options={LYRIC_ALIGN_OPTIONS}
                  value={lyricAlign}
                  onChange={settingsActions.setLyricAlign}
                />
              </YStack>
              <View height={StyleSheet.hairlineWidth} backgroundColor={palette.border} />
              <YStack gap={10}>
                <Text color={palette.textSecondary} fontSize={13} fontWeight="600">
                  歌词字号
                </Text>
                <SegmentedControl
                  options={LYRIC_FONT_OPTIONS}
                  value={String(lyricFontSize)}
                  onChange={(next) => settingsActions.setLyricFontSize(Number(next) as LyricFontSize)}
                />
              </YStack>
              <View height={StyleSheet.hairlineWidth} backgroundColor={palette.border} />
              <XStack alignItems="center" gap={12}>
                <YStack flex={1} gap={2}>
                  <Text color={palette.text} fontSize={14.5} fontWeight="600">
                    歌词翻译
                  </Text>
                  <Text color={palette.textTertiary} fontSize={11.5} lineHeight={16}>
                    外国歌曲在歌词下方显示中文翻译
                  </Text>
                </YStack>
                <Switch
                  size="$2"
                  checked={showLyricTranslation}
                  onCheckedChange={(checked) => settingsActions.setShowLyricTranslation(checked)}
                  backgroundColor={showLyricTranslation ? palette.accent : palette.cardAlt}
                  borderWidth={0}>
                  <Switch.Thumb backgroundColor="#FFFFFF" />
                </Switch>
              </XStack>
              {showLyricTranslation ? (
                <>
                  <View height={StyleSheet.hairlineWidth} backgroundColor={palette.border} />
                  <YStack gap={10}>
                    <Text color={palette.textSecondary} fontSize={13} fontWeight="600">
                      翻译字号
                    </Text>
                    <SegmentedControl
                      options={LYRIC_TRANSLATION_FONT_OPTIONS}
                      value={String(lyricTranslationFontSize)}
                      onChange={(next) =>
                        settingsActions.setLyricTranslationFontSize(Number(next) as LyricTranslationFontSize)
                      }
                    />
                  </YStack>
                </>
              ) : null}
            </YStack>
          </YStack>

          <YStack gap={10}>
            <SectionHeader title="通用" />
            <YStack
              backgroundColor={palette.card}
              borderRadius={20}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor={palette.border}
              paddingVertical={4}
              overflow="hidden">
              <SettingsRow label="版本" value={version ? `v${version}` : '—'} />
              <View
                height={StyleSheet.hairlineWidth}
                backgroundColor={palette.border}
                marginHorizontal={14}
              />
              <SettingsRow
                label="在线升级"
                value={hasUpdate && updateInfo ? `有新版本 ${updateInfo.version}` : undefined}
                onPress={openUpdateModal}
              />
              <View
                height={StyleSheet.hairlineWidth}
                backgroundColor={palette.border}
                marginHorizontal={14}
              />
              <View
                height={StyleSheet.hairlineWidth}
                backgroundColor={palette.border}
                marginHorizontal={14}
              />
              <SettingsRow
                label="GitHub"
                icon="logo-github"
                onPress={() => openWeb(REPO_URL, 'GitHub')}
              />
              <View
                height={StyleSheet.hairlineWidth}
                backgroundColor={palette.border}
                marginHorizontal={14}
              />
              <SettingsRow
                label="关于"
                icon="information-circle-outline"
                onPress={() => setAboutVisible(true)}
              />
              {loggedIn ? (
                <>
                  <View
                    height={StyleSheet.hairlineWidth}
                    backgroundColor={palette.border}
                    marginHorizontal={14}
                  />
                  <SettingsRow label="退出登录" danger onPress={confirmLogout} />
                </>
              ) : null}
            </YStack>
          </YStack>

          {version ? (
            <Text color={palette.textTertiary} fontSize={11} textAlign="center" paddingTop={6}>
              DL Music v{version}
            </Text>
          ) : null}
        </YStack>
      </ScrollView>

      <Modal
        visible={aboutVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAboutVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setAboutVisible(false)}>
          <Pressable style={styles.modalContainer} onPress={(event) => event.stopPropagation()}>
            <YStack
              maxHeight="82%"
              backgroundColor={palette.card}
              borderRadius={22}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor={palette.border}
              overflow="hidden">
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalContent}>
                <Text color={palette.text} fontSize={21} fontWeight="800" textAlign="center">
                  免责声明
                </Text>
                <YStack gap={12}>
                  {DISCLAIMER.map((content) => (
                    <Text key={content} color={palette.textSecondary} fontSize={13} lineHeight={20}>
                      {content}
                    </Text>
                  ))}
                </YStack>
                <XStack
                  height={44}
                  borderRadius={14}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor={palette.accent}
                  transition="quickest"
                  pressStyle={{ opacity: 0.78 }}
                  onPress={() => setAboutVisible(false)}>
                  <Text color={palette.onAccent} fontSize={14.5} fontWeight="700">
                    关闭
                  </Text>
                </XStack>
                <Text color={palette.textTertiary} fontSize={11} textAlign="center">
                  © DL Music{version ? ` V${version} - ${Platform.OS}` : ''}
                </Text>
              </ScrollView>
            </YStack>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={updateVisible}
        transparent
        animationType="fade"
        onRequestClose={closeUpdateModal}>
        <Pressable style={styles.modalOverlay} onPress={closeUpdateModal}>
          <Pressable style={styles.modalContainer} onPress={(event) => event.stopPropagation()}>
            <YStack
              maxHeight="82%"
              backgroundColor={palette.card}
              borderRadius={22}
              borderWidth={StyleSheet.hairlineWidth}
              borderColor={palette.border}
              overflow="hidden">
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalContent}>
                <YStack gap={6} alignItems="center">
                  <Text color={palette.text} fontSize={21} fontWeight="800" textAlign="center">
                    在线升级
                  </Text>
                  <Text color={palette.textSecondary} fontSize={13}>
                    当前版本 v{version}
                  </Text>
                </YStack>

                {/* 步骤 1：尚未检查 —— 先展示「检查更新」按钮 */}
                {!updateInfo ? (
                  <>
                    <Text color={palette.textTertiary} fontSize={12.5} textAlign="center">
                      点击下方按钮检查是否有新版本
                    </Text>
                    <XStack
                      height={46}
                      borderRadius={14}
                      alignItems="center"
                      justifyContent="center"
                      backgroundColor={palette.accent}
                      opacity={checkingUpdate ? 0.6 : 1}
                      pressStyle={checkingUpdate ? undefined : { opacity: 0.78 }}
                      onPress={() => {
                        if (!checkingUpdate) handleCheckClick();
                      }}>
                      <Text color={palette.onAccent} fontSize={14.5} fontWeight="700">
                        {checkingUpdate ? '检查中…' : '检查更新'}
                      </Text>
                    </XStack>
                  </>
                ) : (
                  <>
                    {version && compareVersion(updateInfo.version, version) > 0 ? (
                      <XStack
                        backgroundColor={palette.accent}
                        borderRadius={10}
                        paddingVertical={7}
                        paddingHorizontal={12}
                        alignSelf="center">
                        <Text color={palette.onAccent} fontSize={12} fontWeight="700">
                          发现新版本 {updateInfo.version}
                        </Text>
                      </XStack>
                    ) : (
                      <Text color={palette.textTertiary} fontSize={13} textAlign="center">
                        已是最新版本 v{updateInfo.version}
                      </Text>
                    )}

                    {updateInfo.notes ? (
                      <YStack
                        backgroundColor={palette.cardAlt}
                        borderRadius={12}
                        padding={12}
                        maxHeight={160}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                          <Text color={palette.textSecondary} fontSize={12.5} lineHeight={19}>
                            {updateInfo.notes}
                          </Text>
                        </ScrollView>
                      </YStack>
                    ) : null}

                    {/* 步骤 2：有新版本且当前平台有包 —— 下载更新 */}
                    {pickAssetUrl(updateInfo) &&
                    version &&
                    compareVersion(updateInfo.version, version) > 0 ? (
                      <YStack gap={10}>
                        <XStack
                          height={46}
                          borderRadius={14}
                          alignItems="center"
                          justifyContent="center"
                          backgroundColor={palette.accent}
                          opacity={snap.status === 'downloading' || installing ? 0.6 : 1}
                          pressStyle={
                            snap.status === 'downloading' || installing
                              ? undefined
                              : { opacity: 0.78 }
                          }
                          onPress={() => {
                            if (snap.status !== 'downloading' && !installing) {
                              void handleDownloadUpdate();
                            }
                          }}>
                          <Text color={palette.onAccent} fontSize={14.5} fontWeight="700">
                            {installing
                              ? '正在打开…'
                              : snap.status === 'downloading'
                                ? '下载中…'
                                : snap.status === 'done'
                                  ? '重新安装'
                                  : '下载更新'}
                          </Text>
                        </XStack>

                        {snap.status === 'downloading' && snap.progress ? (
                          <YStack gap={6}>
                            <XStack alignItems="center" justifyContent="space-between">
                              <Text color={palette.textSecondary} fontSize={11.5}>
                                {snap.progress.fraction >= 0
                                  ? `${Math.round(snap.progress.fraction * 100)}%`
                                  : '下载中…'}
                              </Text>
                              <Text color={palette.textTertiary} fontSize={11}>
                                {formatBytes(snap.progress.written)}
                                {snap.progress.total > 0
                                  ? ` / ${formatBytes(snap.progress.total)}`
                                  : ''}
                              </Text>
                            </XStack>
                            <View
                              height={6}
                              borderRadius={3}
                              backgroundColor={palette.cardAlt}
                              overflow="hidden">
                              <View
                                height={6}
                                borderRadius={3}
                                backgroundColor={palette.accent}
                                width={
                                  snap.progress.fraction >= 0
                                    ? `${Math.round(snap.progress.fraction * 100)}%`
                                    : '12%'
                                }
                              />
                            </View>
                            <Text color={palette.textTertiary} fontSize={10.5} textAlign="center">
                              下载可在后台继续，返回此页可查看进度
                            </Text>
                          </YStack>
                        ) : null}

                        {snap.status === 'error' && snap.error ? (
                          <Text color={palette.danger} fontSize={11} textAlign="center">
                            {snap.error}
                          </Text>
                        ) : null}

                        {Platform.OS === 'ios' ? (
                          <Text
                            color={palette.textTertiary}
                            fontSize={11}
                            textAlign="center"
                            lineHeight={16}>
                            下载完成后用系统面板保存到「文件」，再用 SideStore / LiveContainer 重新签名安装
                          </Text>
                        ) : null}
                      </YStack>
                    ) : (
                      <Text color={palette.textTertiary} fontSize={12} textAlign="center">
                        {compareVersion(updateInfo.version, version) > 0
                          ? '该版本暂未提供当前平台的安装包'
                          : '无需下载'}
                      </Text>
                    )}

                    <XStack
                      height={38}
                      borderRadius={11}
                      alignItems="center"
                      justifyContent="center"
                      pressStyle={{ opacity: 0.7 }}
                      onPress={() => {
                        setUpdateInfo(null);
                        resetDownload();
                        handledDone.current = null;
                      }}>
                      <Text color={palette.textTertiary} fontSize={12}>
                        重新检查
                      </Text>
                    </XStack>
                  </>
                )}

                <XStack
                  height={42}
                  borderRadius={12}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor={palette.cardAlt}
                  pressStyle={{ opacity: 0.7 }}
                  onPress={closeUpdateModal}>
                  <Text color={palette.textSecondary} fontSize={14} fontWeight="600">
                    关闭
                  </Text>
                </XStack>
              </ScrollView>
            </YStack>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.52)',
  },
  modalContainer: {
    width: '100%',
    maxWidth: 560,
  },
  modalContent: {
    gap: 18,
    padding: 20,
  },
});
