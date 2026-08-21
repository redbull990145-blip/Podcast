import type { PlayableEpisode } from '@cue/core';
import { icon } from '@cue/design';
import { pressScale, spring, springRest } from '@cue/motion';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Icon } from '@/components/icon';
import { playerActions, usePlayerSelector } from '@/lib/player/store';
import { space, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Queue an episode, or take it back out.
 *
 * One control rather than a menu. Where it lands in the queue is decided on
 * the queue screen, which is the only place the order is visible.
 */
export function QueueButton({ episode }: { episode: PlayableEpisode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  const queued = usePlayerSelector((s) => s.queue.some((item) => item.id === episode.id));
  const isCurrent = usePlayerSelector((s) => s.current?.id === episode.id);

  const depth = pressScale(0.92, reduced);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - depth) }],
  }));

  // Queueing what is already playing is meaningless, so the control goes away
  // rather than sitting there doing nothing. After the hooks, never before —
  // an early return above them changes the hook count between renders.
  if (isCurrent) return null;

  return (
    <AnimatedPressable
      onPress={() => {
        if (queued) {
          playerActions.removeFromQueue(episode.id);
          return;
        }
        playerActions.enqueue(episode);
      }}
      onPressIn={() => {
        pressed.value = withSpring(1, { ...spring.snappy, ...springRest });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { ...spring.snappy, ...springRest });
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: queued }}
      accessibilityLabel={
        queued ? `Remove ${episode.title} from the queue` : `Add ${episode.title} to the queue`
      }
      hitSlop={space[2]}
      style={[styles.button, animated]}
    >
      <Icon
        path={queued ? icon.check : icon.plus}
        size={20}
        color={queued ? theme.accentText : theme.textTertiary}
      />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
