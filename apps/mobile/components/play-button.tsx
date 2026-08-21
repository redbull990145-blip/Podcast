import { icon } from '@cue/design';
import { pressScale, spring, springRest } from '@cue/motion';
import type { PlayableEpisode } from '@cue/core';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Icon } from '@/components/icon';
import { playerActions, usePlayerSelector } from '@/lib/player/store';
import { radius, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Play, pause, or resume this episode.
 *
 * One control with three meanings, decided by what the player is doing rather
 * than by the caller: a row for the episode already playing must not offer to
 * start it again from wherever it was.
 */
export function PlayButton({ episode, size = 40 }: { episode: PlayableEpisode; size?: number }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  // Two primitives rather than the whole state: the engine reports twice a
  // second, and this button does not care about position ticks.
  const isCurrent = usePlayerSelector((s) => s.current?.id === episode.id);
  const statusPlaying = usePlayerSelector((s) => s.status === 'playing');
  const isPlaying = isCurrent && statusPlaying;

  // Reduced motion keeps the squash and makes it shallower; it does not remove
  // it. On a touch screen this is the only thing that answers "did that land?"
  const depth = pressScale(0.92, reduced);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - depth) }],
  }));

  return (
    <AnimatedPressable
      onPress={() => {
        if (isCurrent) {
          playerActions.toggle();
          return;
        }
        void playerActions.play(episode);
      }}
      onPressIn={() => {
        pressed.value = withSpring(1, { ...spring.snappy, ...springRest });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { ...spring.snappy, ...springRest });
      }}
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? `Pause ${episode.title}` : `Play ${episode.title}`}
      // The touch target stays 44px even when the button is drawn smaller.
      hitSlop={Math.max(0, (44 - size) / 2)}
      style={[
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: radius.full,
          backgroundColor: isCurrent ? theme.accent : theme.surfaceRaised,
          borderColor: theme.border,
        },
        animated,
      ]}
    >
      <Icon
        path={isPlaying ? icon.pause : icon.play}
        size={size * 0.5}
        color={isCurrent ? theme.textOnAccent : theme.textPrimary}
        filled
      />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
