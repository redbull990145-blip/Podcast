import { icon } from '@cue/design';
import { duration, easing, spring, springRest } from '@cue/motion';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { Icon } from '@/components/icon';
import { playerActions, usePlayerState } from '@/lib/player/store';
import { TAB_BAR_HEIGHT, space, type, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The mini player.
 *
 * Sits on the tab bar and is the only way back to what is playing, so it must
 * never unmount — it lives beside the navigator rather than inside a screen.
 *
 * It is absent entirely until something has been played. A dead transport bar
 * on first launch is chrome advertising a feature the listener has not reached
 * yet.
 *
 * `bottomOffset` is what sits *below* the bar, above the safe area — the tab
 * bar's height in the shell, and nothing on a pushed screen that covers it. It
 * is a parameter rather than a constant because the number is a fact about the
 * host screen, and a bar that assumes one always fills the gap it left behind.
 */
export function MiniPlayer({ bottomOffset = TAB_BAR_HEIGHT }: { bottomOffset?: number } = {}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduced = useReducedMotion();
  const state = usePlayerState();

  const pressed = useSharedValue(0);

  const hasEpisode = state.current !== null;

  /**
   * Entrance.
   *
   * The bar only ever arrives — once something has played, `current` stays
   * set for the life of the app — so this is a one-way animation and there is
   * no exit to write. It rises rather than fading in, because it comes *from*
   * the tab bar it now sits above.
   */
  const entrance = useSharedValue(0);

  const container = useAnimatedStyle(() => ({
    transform: [
      { translateY: (1 - entrance.value) * 72 },
      { scale: 1 - pressed.value * 0.01 },
    ],
    // Opacity is tweened, never sprung: a spring overshoots past 1, the
    // compositor clamps it, and the clamp reads as a flicker.
    opacity: withTiming(entrance.value, {
      duration: duration.fast,
      easing: Easing.bezier(...easing.standard),
    }),
  }));

  useEffect(() => {
    if (!hasEpisode) return;
    // Reduced motion reduces rather than removes: the bar still appears, it
    // just stops travelling to do it.
    entrance.value = reduced
      ? withTiming(1, { duration: duration.fast, easing: Easing.bezier(...easing.enter) })
      : withSpring(1, { ...spring.expressive, ...springRest });
  }, [hasEpisode, reduced, entrance]);

  /** Progress along the episode, as a hairline under the bar. */
  const progress = useAnimatedStyle(() => {
    const total = state.durationSec;
    const fraction =
      total && total > 0 ? Math.min(1, Math.max(0, state.positionSec / total)) : 0;
    return { width: `${fraction * 100}%` };
  });

  if (!hasEpisode) return null;

  const episode = state.current!;
  const isPlaying = state.status === 'playing';

  return (
    <Animated.View
      style={[
        styles.wrap,
        { bottom: bottomOffset + insets.bottom },
        container,
      ]}
      pointerEvents="box-none"
    >
      <AnimatedPressable
        onPress={() => router.push('/player')}
        onPressIn={() => {
          pressed.value = withSpring(1, { ...spring.responsive, ...springRest });
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, { ...spring.responsive, ...springRest });
        }}
        accessibilityRole="button"
        accessibilityLabel={`Now playing: ${episode.title}. Open the player.`}
        style={[
          styles.bar,
          { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
        ]}
      >
        <Artwork url={episode.artworkUrl} size={40} />

        <View style={styles.text}>
          <Text numberOfLines={1} style={[type('caption'), { color: theme.textPrimary }]}>
            {episode.title}
          </Text>
          <Text numberOfLines={1} style={[type('overline'), { color: theme.textTertiary }]}>
            {state.status === 'loading' ? 'Loading…' : episode.podcastTitle}
          </Text>
        </View>

        <Pressable
          onPress={() => playerActions.toggle()}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          hitSlop={space[3]}
          style={styles.transport}
        >
          <Icon
            path={isPlaying ? icon.pause : icon.play}
            size={22}
            color={theme.textPrimary}
            filled
          />
        </Pressable>
      </AnimatedPressable>

      <View style={[styles.track, { backgroundColor: theme.border }]}>
        <Animated.View style={[styles.fill, { backgroundColor: theme.accent }, progress]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space[2],
    right: space[2],
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[2],
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1 },
  transport: { padding: space[1] },
  track: {
    height: 2,
    marginHorizontal: space[3],
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    overflow: 'hidden',
  },
  fill: { height: 2 },
});
