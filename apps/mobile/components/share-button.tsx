import { formatTimestamp, shouldShareTime } from '@cue/core';
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
import { useTranslator } from '@/lib/i18n';
import { usePlayerState } from '@/lib/player/store';
import { shareEpisode } from '@/lib/share';
import { space, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Share this episode, from where you are in it.
 *
 * The position comes from the player only when *this* episode is the one
 * playing. Sharing the episode you are reading about with a timestamp from the
 * episode in your ears would be a baffling link to receive.
 */
export function ShareButton({ episodeId, title }: { episodeId: string; title: string }) {
  const t = useTranslator();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const state = usePlayerState();
  const pressed = useSharedValue(0);

  const depth = pressScale(0.92, reduced);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - depth) }],
  }));

  const isCurrent = state.current?.id === episodeId;
  const position = isCurrent ? Math.floor(state.positionSec) : null;
  const withTime = position !== null && shouldShareTime(position, state.durationSec);

  return (
    <AnimatedPressable
      onPress={() => {
        void shareEpisode({
          episodeId,
          title,
          positionSec: position,
          durationSec: state.durationSec,
        });
      }}
      onPressIn={() => {
        pressed.value = withSpring(1, { ...spring.snappy, ...springRest });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { ...spring.snappy, ...springRest });
      }}
      accessibilityRole="button"
      // The label names the moment when there is one: a bare "Share" beside a
      // playing episode hides the whole point of the feature from anyone who
      // cannot see which button lit up.
      accessibilityLabel={
        withTime && position !== null
          ? t.t('share.fromHere', { time: formatTimestamp(position) })
          : t.t('share.episode')
      }
      hitSlop={space[2]}
      style={[styles.button, animated]}
    >
      <Icon path={icon.share} size={20} color={theme.textTertiary} />
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
