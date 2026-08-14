import { queryKeys } from '@cue/api-client';
import { playableFromQueueEntry } from '@cue/core';
import { useTranslator } from '@/lib/i18n';
import { deriveTint, icon } from '@cue/design';
import type { ContinueEntry } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Artwork } from '@/components/artwork';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { playerActions } from '@/lib/player/store';
import { useSession } from '@/lib/session';
import { radius, space, type, useTheme } from '@/theme';

/**
 * Pick up where you left off.
 *
 * Heads the Listen screen because it answers why the app was opened. A
 * catalogue answers "what exists", and almost nobody arrives asking that —
 * they arrive part way through something.
 *
 * Two entries, not a carousel. On a phone a horizontal rail costs a gesture to
 * read and hides most of its contents; the one touched most recently is
 * overwhelmingly the one wanted, so it gets the room and the runner-up gets a
 * line. Absent entirely when nothing is in progress.
 */
export function ContinueListening() {
  const theme = useTheme();
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.continue(),
    queryFn: () => api.getContinue(2),
    enabled: isSignedIn,
    // Position moves while listening, and this is the one screen where a stale
    // figure shows up as a progress bar in the wrong place.
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={[type('overline'), { color: theme.textTertiary, marginBottom: space[2] }]}>
        PICK UP WHERE YOU LEFT OFF
      </Text>

      {items.map((entry, index) => (
        <Row key={entry.episode.id} entry={entry} lead={index === 0} />
      ))}
    </View>
  );
}

function Row({ entry, lead }: { entry: ContinueEntry; lead: boolean }) {
  const t = useTranslator();
  const theme = useTheme();

  const tint = entry.accentColor ? deriveTint(entry.accentColor, 'dark') : null;
  const total = entry.durationSec ?? entry.episode.durationSec;
  const fraction =
    total && total > 0 ? Math.min(1, Math.max(0, entry.positionSec / total)) : 0;
  const left = total && total > 0 ? t.duration(Math.max(0, total - entry.positionSec)) : null;

  const size = lead ? 64 : 44;

  return (
    <Pressable
      onPress={() => void playerActions.play(playableFromQueueEntry(entry))}
      accessibilityRole="button"
      accessibilityLabel={`Resume ${entry.episode.title}${left ? `, ${left} left` : ''}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? (tint?.wash ?? theme.surfaceHover)
            : lead
              ? (tint?.wash ?? theme.surfaceRaised)
              : 'transparent',
          borderRadius: radius.md,
        },
      ]}
    >
      <Artwork url={entry.episode.artworkUrl ?? entry.podcastArtworkUrl} size={size} />

      <View style={styles.text}>
        <Text
          numberOfLines={2}
          style={[type(lead ? 'bodyStrong' : 'body'), { color: theme.textPrimary }]}
        >
          {entry.episode.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[type('caption'), { color: theme.textTertiary, marginTop: 2 }]}
        >
          {entry.podcastTitle}
          {left ? ` · ${left} left` : ''}
        </Text>

        {/* Only the lead carries a bar. On the runner-up it would be a second
            hairline directly under the first and read as a divider. */}
        {lead ? (
          <View style={[styles.track, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.fill,
                { width: `${fraction * 100}%`, backgroundColor: tint?.fill ?? theme.accent },
              ]}
            />
          </View>
        ) : null}
      </View>

      <Icon path={icon.play} size={lead ? 24 : 20} color={theme.textPrimary} filled />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: space[4], paddingBottom: space[6] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[2],
    marginBottom: space[1],
  },
  text: { flex: 1 },
  track: { height: 3, marginTop: space[2], borderRadius: 3, overflow: 'hidden' },
  fill: { height: 3 },
});
