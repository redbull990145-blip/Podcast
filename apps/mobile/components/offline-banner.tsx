import { icon } from '@cue/design';
import { duration, easing, type Easing as Curve } from '@cue/motion';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Icon } from '@/components/icon';
import { useOnline } from '@/lib/connectivity';
import { useDownloadIndex } from '@/lib/downloads/store';
import { useTranslator } from '@/lib/i18n';
import { radius, space, type, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A strip that says the connection is gone, and what still works.
 *
 * Deliberately not an error. Losing signal on a phone is ordinary — a tunnel, a
 * lift, a flight — and an app that treats it as a fault spends a whole commute
 * apologising. The sentence leads with what the listener can still do, and the
 * strip is a shortcut to Downloads when there is anything in them, because that
 * is the only useful action available while offline.
 *
 * It fades rather than sliding. It arrives without being asked for, so it must
 * not shove the screen around to do it — and opacity is the one channel reduced
 * motion always keeps, which makes this the same transition for everybody
 * rather than one with a second path to get wrong.
 */
export function OfflineBanner({ bottom }: { bottom: number }) {
  const t = useTranslator();
  const theme = useTheme();
  const router = useRouter();
  const online = useOnline();
  const hasSaved = Object.values(useDownloadIndex()).some(
    (record) => record.status === 'complete',
  );

  const shown = useSharedValue(0);

  useEffect(() => {
    // Leaving is quicker and does not decelerate: it is not going anywhere the
    // eye needs to follow.
    const curve: Curve = online ? easing.exit : easing.enter;

    shown.value = withTiming(online ? 0 : 1, {
      duration: online ? duration.fast : duration.base,
      easing: Easing.bezier(...curve),
    });
  }, [online, shown]);

  const animated = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <AnimatedPressable
      onPress={hasSaved ? () => router.push('/downloads') : undefined}
      disabled={online || !hasSaved}
      // Mounted either way and faded, rather than added and removed: a view
      // that appears cannot animate its own arrival from nothing, and this one
      // has to be able to leave as gently as it came.
      pointerEvents={online ? 'none' : 'auto'}
      accessibilityRole={hasSaved ? 'button' : 'alert'}
      accessibilityElementsHidden={online}
      importantForAccessibility={online ? 'no-hide-descendants' : 'yes'}
      accessibilityLabel={
        hasSaved
          ? `${t.t('offline.banner')} ${t.t('offline.openDownloads')}`
          : t.t('offline.title')
      }
      accessibilityLiveRegion="polite"
      style={[
        styles.bar,
        { bottom, backgroundColor: theme.surfaceOverlay, borderColor: theme.border },
        animated,
      ]}
    >
      <Icon path={icon.offline} size={18} color={theme.textSecondary} />
      <Text numberOfLines={1} style={[type('caption'), styles.text, { color: theme.textSecondary }]}>
        {hasSaved ? t.t('offline.banner') : t.t('offline.title')}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: space[2],
    right: space[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1 },
});
