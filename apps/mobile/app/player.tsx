import { PLAYBACK_RATES, type PlaybackRate } from '@cue/core';
import { icon } from '@cue/design';
import { pressScale, spring, springRest } from '@cue/motion';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenMessage } from '@/components/screen-message';
import { Scrubber } from '@/components/scrubber';
import { playerActions, usePlayerState } from '@/lib/player/store';
import { radius, space, type, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const SLEEP_OPTIONS = [15, 30, 45, 60] as const;

/**
 * Now Playing.
 *
 * The one screen that is a place you are in rather than a page you went to, so
 * it is artwork-led and the controls sit under it rather than beside it.
 */
export default function PlayerScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const state = usePlayerState();

  if (!state.current) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
        <ScreenMessage
          title="Nothing playing"
          body="Pick an episode and it will show up here."
        />
      </View>
    );
  }

  const episode = state.current;
  const isPlaying = state.status === 'playing';

  // Square, but never taller than leaves room for the controls beneath it.
  const artworkSize = Math.min(width - space[10] * 2, 360);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[8] },
      ]}
    >
      <View style={styles.topBar}>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close the player"
          hitSlop={space[3]}
          scale={0.9}
          style={styles.dismiss}
        >
          <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
        </PressableScale>

        {/* What is playing, and from where.

            The episode title is below the cover where it belongs, but a
            full-screen player with nothing in the middle of its header reads
            as an unfinished dialog — and "playing from" is the one fact the
            screen otherwise leaves you to infer from a line of small text
            three hundred points further down. */}
        <View style={styles.playingFrom}>
          <Text style={[type('overline'), { color: theme.textTertiary }]}>
            PLAYING FROM
          </Text>
          <Text
            numberOfLines={1}
            style={[type('caption'), { color: theme.textPrimary, marginTop: 2 }]}
          >
            {episode.podcastTitle}
          </Text>
        </View>

        <Pressable
          onPress={() => router.push('/queue')}
          accessibilityRole="button"
          accessibilityLabel={
            state.queue.length === 0
              ? 'Queue, empty'
              : `Queue, ${state.queue.length} waiting`
          }
          hitSlop={space[3]}
          style={styles.queueButton}
        >
          <Icon path={icon.queue} size={22} color={theme.textSecondary} />
          {state.queue.length > 0 ? (
            <Text style={[type('caption'), { color: theme.textSecondary }]}>
              {state.queue.length}
            </Text>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.artwork}>
        <Artwork url={episode.artworkUrl} size={artworkSize} label={episode.podcastTitle} />
      </View>

      {/* Start-aligned, not centred. Centred metadata under a cover
          re-centres on every episode as the title length changes, which is
          visible as drift each time the track advances. */}
      <View style={styles.meta}>
        <Text style={[type('title2'), { color: theme.textPrimary }]}>{episode.title}</Text>
        <Text style={[type('callout'), { color: theme.textTertiary, marginTop: space[1] }]}>
          {episode.podcastTitle}
        </Text>
      </View>

      {state.error ? (
        <Text
          style={[
            type('caption'),
            { color: theme.danger, marginTop: space[4], textAlign: 'center' },
          ]}
        >
          {state.error}
        </Text>
      ) : null}

      <Scrubber
        positionSec={state.positionSec}
        durationSec={state.durationSec}
        onSeek={playerActions.seek}
      />

      <View style={styles.transport}>
        <TransportButton
          label="Skip back 15 seconds"
          path={icon.skipBack}
          onPress={playerActions.skipBack}
        />

        <PlayPauseButton isPlaying={isPlaying} isLoading={state.status === 'loading'} />

        <TransportButton
          label="Skip forward 30 seconds"
          path={icon.skipForward}
          onPress={playerActions.skipForward}
        />
      </View>

      <View style={styles.row}>
        <Text style={[type('overline'), { color: theme.textTertiary }]}>SPEED</Text>
        <View style={styles.chips}>
          {PLAYBACK_RATES.map((rate) => (
            <Chip
              key={rate}
              label={`${rate}×`}
              selected={state.rate === rate}
              onPress={() => playerActions.setRate(rate as PlaybackRate)}
            />
          ))}
        </View>
      </View>

      <View style={styles.row}>
        <Text style={[type('overline'), { color: theme.textTertiary }]}>SLEEP TIMER</Text>
        <View style={styles.chips}>
          <Chip
            label="Off"
            selected={state.sleepAtMs === null}
            onPress={() => playerActions.setSleepTimer(null)}
          />
          {SLEEP_OPTIONS.map((minutes) => (
            <Chip
              key={minutes}
              label={`${minutes}m`}
              // The machine stores a wall-clock deadline rather than a
              // countdown, so there is no "which preset is active" to read
              // back — only whether one is set at all.
              selected={false}
              onPress={() => playerActions.setSleepTimer(minutes)}
            />
          ))}
        </View>
      </View>

      {state.sleepAtMs !== null ? (
        <Text
          style={[
            type('caption'),
            { color: theme.textSecondary, marginTop: space[2], textAlign: 'center' },
          ]}
        >
          {`Stopping at ${new Date(state.sleepAtMs).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}`}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function PlayPauseButton({ isPlaying, isLoading }: { isPlaying: boolean; isLoading: boolean }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  // Resolved on the JS thread and closed over by the worklet: `pressScale` is
  // an import, so the Reanimated plugin cannot workletize it to run inline.
  const depth = pressScale(0.94, reduced);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - depth) }],
  }));

  return (
    <AnimatedPressable
      onPress={() => playerActions.toggle()}
      onPressIn={() => {
        pressed.value = withSpring(1, { ...spring.responsive, ...springRest });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, { ...spring.responsive, ...springRest });
      }}
      accessibilityRole="button"
      accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
      accessibilityState={{ busy: isLoading }}
      style={[styles.playButton, { backgroundColor: theme.ink }, animated]}
    >
      <Icon
        path={isPlaying ? icon.pause : icon.play}
        size={32}
        color={theme.textOnInk}
        filled
      />
    </AnimatedPressable>
  );
}

function TransportButton({
  label,
  path,
  onPress,
}: {
  label: string;
  path: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={space[2]}
      scale={0.9}
      style={styles.transportButton}
    >
      <Icon path={path} size={28} color={theme.textPrimary} />
    </PressableScale>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    // A wash rather than a squash: these are text surfaces, and the selection
    // state already lives in their fill — the press only has to acknowledge.
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected
            ? theme.accentMuted
            : pressed
              ? theme.surfaceHover
              : 'transparent',
          borderColor: selected ? theme.accent : theme.border,
        },
      ]}
    >
      <Text
        style={[type('caption'), { color: selected ? theme.accentText : theme.textSecondary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[6], alignItems: 'center', flexGrow: 1 },
  topBar: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dismiss: { padding: space[2] },
  playingFrom: { flex: 1, alignItems: 'center' },
  queueButton: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[2] },
  artwork: { marginTop: space[6] },
  meta: { marginTop: space[6], alignSelf: 'stretch' },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[8],
    marginTop: space[6],
  },
  transportButton: { padding: space[2] },
  playButton: {
    width: 76,
    height: 76,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { width: '100%', marginTop: space[8], alignItems: 'center', gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'center' },
  chip: {
    minHeight: 36,
    paddingHorizontal: space[4],
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
