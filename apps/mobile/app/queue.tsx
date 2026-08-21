import type { PlayableEpisode } from '@cue/core';
import { useTranslator } from '@/lib/i18n';
import { icon } from '@cue/design';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '@/components/artwork';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenMessage } from '@/components/screen-message';
import { playerActions, usePlayerState } from '@/lib/player/store';
import { radius, space, type, useTheme } from '@/theme';

/**
 * The queue.
 *
 * Reached from Now Playing rather than given a fourth tab: it is only
 * meaningful once something is playing, and a permanently visible tab that is
 * empty for most of a listener's first session is chrome advertising a feature
 * they have not reached.
 *
 * Reordering is by explicit move controls rather than by dragging. A drag on a
 * scrolling list needs long-press arming, auto-scroll at the edges, and a
 * fallback for screen readers to be correct — and move buttons are the
 * fallback, so they are what this ships until the drag can be built and tested
 * on a real device.
 */
export default function QueueScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = usePlayerState();

  const queue = state.queue;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close the queue"
          hitSlop={space[3]}
          scale={0.9}
          style={styles.dismiss}
        >
          <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
        </PressableScale>

        <View style={styles.headerText}>
          <Text style={[type('title2'), { color: theme.textPrimary }]}>Queue</Text>
          <Text style={[type('caption'), { color: theme.textSecondary, marginTop: space[1] }]}>
            {queue.length === 0
              ? 'Nothing lined up.'
              : `${queue.length} ${queue.length === 1 ? 'episode' : 'episodes'} after this one.`}
          </Text>
        </View>

        {queue.length > 0 ? (
          <Pressable
            onPress={() => playerActions.clearQueue()}
            accessibilityRole="button"
            accessibilityLabel="Clear the queue"
            hitSlop={space[2]}
            style={styles.clear}
          >
            <Text style={[type('caption'), { color: theme.textSecondary }]}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {queue.length === 0 ? (
        <ScreenMessage
          title={state.current ? 'Nothing after this one' : 'Nothing lined up'}
          body={
            state.current
              ? 'Add an episode from any show and it will play when this one finishes.'
              : 'Queue episodes from a show and they will play back to back.'
          }
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space[8] }}>
          {queue.map((episode, index) => (
            <QueueRow
              key={episode.id}
              episode={episode}
              position={index + 1}
              isFirst={index === 0}
              isLast={index === queue.length - 1}
              onMove={(direction) => moveInQueue(queue, index, direction)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Move one item and push the whole resulting order.
 *
 * The machine takes an order rather than a move, which makes this operation
 * idempotent — replaying it cannot walk an episode twice down the list the way
 * a relative "move down" would.
 */
function moveInQueue(queue: PlayableEpisode[], index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= queue.length) return;

  const ids = queue.map((item) => item.id);
  const [moved] = ids.splice(index, 1);
  ids.splice(target, 0, moved!);

  playerActions.reorderQueue(ids);
}

function QueueRow({
  episode,
  position,
  isFirst,
  isLast,
  onMove,
}: {
  episode: PlayableEpisode;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const t = useTranslator();
  const theme = useTheme();
  const length = t.duration(episode.durationSec);

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Text
        style={[type('caption'), styles.position, { color: theme.textTertiary }]}
        accessibilityElementsHidden
      >
        {position}
      </Text>

      <Artwork url={episode.artworkUrl} size={44} />

      <Pressable
        onPress={() => void playerActions.play(episode)}
        accessibilityRole="button"
        accessibilityLabel={`Play ${episode.title} now`}
        style={styles.rowText}
      >
        <Text numberOfLines={2} style={[type('body'), { color: theme.textPrimary }]}>
          {episode.title}
        </Text>
        <Text numberOfLines={1} style={[type('caption'), { color: theme.textTertiary }]}>
          {episode.podcastTitle}
          {length ? ` · ${length}` : ''}
        </Text>
      </Pressable>

      <View style={styles.controls}>
        <MoveButton
          label={`Move ${episode.title} up`}
          direction={-1}
          disabled={isFirst}
          onPress={onMove}
        />
        <MoveButton
          label={`Move ${episode.title} down`}
          direction={1}
          disabled={isLast}
          onPress={onMove}
        />
        <Pressable
          onPress={() => playerActions.removeFromQueue(episode.id)}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${episode.title} from the queue`}
          hitSlop={space[2]}
          style={({ pressed }) => [
            styles.control,
            pressed && { backgroundColor: theme.surfaceHover },
          ]}
        >
          <Text style={[type('body'), { color: theme.textTertiary }]}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MoveButton({
  label,
  direction,
  disabled,
  onPress,
}: {
  label: string;
  direction: -1 | 1;
  disabled: boolean;
  onPress: (direction: -1 | 1) => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => onPress(direction)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={space[2]}
      style={({ pressed }) => [
        styles.control,
        { opacity: disabled ? 0.25 : 1 },
        pressed && { backgroundColor: theme.surfaceHover },
      ]}
    >
      {/* One chevron path, flipped — the same geometry the rest of the app
          uses for "down". */}
      <View style={direction === -1 ? styles.flipped : undefined}>
        <Icon path={icon.chevronDown} size={20} color={theme.textSecondary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[4],
  },
  dismiss: { padding: space[1] },
  headerText: { flex: 1 },
  clear: { padding: space[2], borderRadius: radius.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  position: { width: 18, textAlign: 'right' },
  rowText: { flex: 1, gap: 2 },
  controls: { flexDirection: 'row', alignItems: 'center' },
  control: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipped: { transform: [{ rotate: '180deg' }] },
});
