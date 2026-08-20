import { queryKeys } from '@cue/api-client';
import { formatTimestamp } from '@cue/core/format';
import { playableFromQueueEntry } from '@cue/core';
import { useTranslator } from '@/lib/i18n';
import { deriveTint, icon } from '@cue/design';
import type { ContinueEntry } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Artwork } from '@/components/artwork';
import { Icon } from '@/components/icon';
import { api } from '@/lib/api';
import { playerActions } from '@/lib/player/store';
import { useSession } from '@/lib/session';
import { radius, space, type, useTheme } from '@/theme';

/** The screen's horizontal gutter, which the hero deliberately breaks out of. */
const GUTTER = space[5];
/** Wide enough for a two-line title beside a 52px cover, narrow enough that
 *  the next card is visibly peeking — which is what says "this scrolls". */
const CARD_WIDTH = 236;

/**
 * Pick up where you left off.
 *
 * Heads the Listen screen because it answers why the app was opened. A
 * catalogue answers "what exists", and almost nobody arrives asking that —
 * they arrive part way through something.
 *
 * **The lead is a band, not a row.** Full width, edge to edge, on its own
 * surface with a hairline top and bottom. On a 390px screen an inset card with
 * rounded corners spends thirty points of the narrowest layout in the app on
 * decoration, and the thing it is decorating is the one item on the screen
 * that does not need help being found.
 *
 * The runners-up are a horizontal scroller, which is the one place in this app
 * a rail is the right answer: they are genuine peers, there are at most three,
 * and three cards do not fit across a phone at any size worth reading.
 */
export function ContinueListening() {
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.continue(),
    queryFn: () => api.getContinue(4),
    enabled: isSignedIn,
    // Position moves while listening, and this is the one screen where a stale
    // figure shows up as a progress bar in the wrong place.
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  const [lead, ...rest] = items;

  if (!lead) return null;

  return (
    <View>
      <Hero entry={lead} />
      {rest.length > 0 ? <AlsoInProgress entries={rest} /> : null}
    </View>
  );
}

function progressOf(entry: ContinueEntry) {
  const total = entry.durationSec ?? entry.episode.durationSec;
  if (!total || total <= 0) return { fraction: 0, remaining: null, total: null };
  return {
    fraction: Math.min(1, Math.max(0, entry.positionSec / total)),
    remaining: Math.max(0, total - entry.positionSec),
    total,
  };
}

function Hero({ entry }: { entry: ContinueEntry }) {
  const t = useTranslator();
  const theme = useTheme();
  const router = useRouter();
  const { fraction, remaining } = progressOf(entry);

  const tint = entry.accentColor ? deriveTint(entry.accentColor, 'dark') : null;
  const playable = playableFromQueueEntry(entry);
  const left = remaining === null ? null : t.duration(remaining);

  return (
    <View
      style={[
        styles.hero,
        {
          backgroundColor: tint?.wash ?? theme.surface,
          borderColor: theme.border,
        },
      ]}
    >
      {/* The rule-and-label eyebrow. The one place the accent is spent on
          words, marking the section that is about what is playing. */}
      <View style={styles.eyebrow}>
        <View style={[styles.rule, { backgroundColor: theme.accentText }]} />
        <Text style={[type('overline'), { color: theme.accentText }]}>
          {t.t('home.pickUp').toUpperCase()}
        </Text>
      </View>

      <Pressable
        onPress={() => router.push(`/episode/${entry.episode.id}`)}
        accessibilityRole="link"
        accessibilityLabel={entry.episode.title}
        style={styles.heroTop}
      >
        <Artwork url={entry.episode.artworkUrl ?? entry.podcastArtworkUrl} size={92} />

        <View style={styles.heroText}>
          <Text numberOfLines={1} style={[type('caption'), { color: theme.textTertiary }]}>
            {entry.podcastTitle}
          </Text>
          <Text
            numberOfLines={3}
            style={[type('title3'), { color: theme.textPrimary, marginTop: 3 }]}
          >
            {entry.episode.title}
          </Text>
        </View>
      </Pressable>

      <View style={[styles.track, { backgroundColor: theme.border }]}>
        <View
          style={[
            styles.fill,
            { width: `${fraction * 100}%`, backgroundColor: tint?.fill ?? theme.accent },
          ]}
        />
      </View>

      <View style={styles.times}>
        <Text style={[type('timecode'), { color: theme.textTertiary }]}>
          {formatTimestamp(entry.positionSec)}
        </Text>
        {left ? (
          <Text style={[type('timecode'), { color: theme.textTertiary }]}>
            {t.t('home.timeLeft', { duration: left })}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => void playerActions.play(playable)}
          accessibilityRole="button"
          accessibilityLabel={t.t('home.resume', { title: entry.episode.title })}
          style={({ pressed }) => [
            styles.resume,
            { backgroundColor: theme.ink, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Icon path={icon.play} size={14} color={theme.textOnInk} filled />
          <Text style={[type('bodyStrong'), { color: theme.textOnInk }]}>
            {t.t('home.continue')}
          </Text>
        </Pressable>

        {/* Start over, rather than a second play button. A half-finished
            episode is the one case where "play" is genuinely ambiguous, and
            `playAt` skips the resume lookup outright so the server's stored
            position cannot quietly overrule it. */}
        <Pressable
          onPress={() => void playerActions.playAt(playable, 0)}
          accessibilityRole="button"
          accessibilityLabel={t.t('home.startOver')}
          style={({ pressed }) => [
            styles.startOver,
            {
              borderColor: theme.borderStrong,
              backgroundColor: pressed ? theme.surfaceHover : 'transparent',
            },
          ]}
        >
          <Icon path={icon.skipBack} size={18} color={theme.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

function AlsoInProgress({ entries }: { entries: ContinueEntry[] }) {
  const t = useTranslator();
  const theme = useTheme();

  return (
    <View style={styles.also}>
      <Text style={[type('title2'), styles.alsoHeading, { color: theme.textPrimary }]}>
        {t.t('home.alsoInProgress')}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Snapping so a swipe lands on a card rather than between two. The
        // interval is the card plus its gap, which is the distance one card
        // actually occupies.
        snapToInterval={CARD_WIDTH + space[3]}
        decelerationRate="fast"
        contentContainerStyle={styles.rail}
      >
        {entries.map((entry) => (
          <ProgressCard key={entry.episode.id} entry={entry} />
        ))}
      </ScrollView>
    </View>
  );
}

function ProgressCard({ entry }: { entry: ContinueEntry }) {
  const t = useTranslator();
  const theme = useTheme();
  const { fraction, remaining, total } = progressOf(entry);

  const left = remaining === null ? null : t.duration(remaining);
  const length = total === null ? null : t.duration(total);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surfaceRaised, borderColor: theme.border },
      ]}
    >
      <View style={styles.cardTop}>
        <Artwork url={entry.episode.artworkUrl ?? entry.podcastArtworkUrl} size={52} />
        <View style={styles.cardText}>
          <Text numberOfLines={2} style={[type('bodyStrong'), { color: theme.textPrimary }]}>
            {entry.episode.title}
          </Text>
          <Text
            numberOfLines={1}
            style={[type('caption'), { color: theme.textTertiary, marginTop: 3 }]}
          >
            {entry.podcastTitle}
          </Text>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <Pressable
          onPress={() => void playerActions.play(playableFromQueueEntry(entry))}
          accessibilityRole="button"
          accessibilityLabel={t.t('home.resume', { title: entry.episode.title })}
          style={({ pressed }) => [
            styles.cardPlay,
            { backgroundColor: theme.ink, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Icon path={icon.play} size={13} color={theme.textOnInk} filled />
        </Pressable>

        <View style={styles.cardMeter}>
          <View style={[styles.trackThin, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.fill,
                { width: `${fraction * 100}%`, backgroundColor: theme.accent },
              ]}
            />
          </View>
          <View style={styles.times}>
            <Text style={[type('timecode'), { color: theme.textTertiary }]}>
              {left ? t.t('home.timeLeft', { duration: left }) : ''}
            </Text>
            <Text style={[type('timecode'), { color: theme.textTertiary }]}>
              {length ?? ''}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: GUTTER,
    paddingTop: space[5],
    paddingBottom: space[5],
    marginBottom: space[7],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  rule: { width: 14, height: 1 },
  heroTop: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  heroText: { flex: 1, paddingTop: 2 },
  track: { height: 4, marginTop: space[4], borderRadius: 4, overflow: 'hidden' },
  trackThin: { height: 3, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%' },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space[1] + 2,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[4] },
  resume: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    height: 46,
    borderRadius: radius.full,
  },
  startOver: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  also: { marginBottom: space[7] },
  alsoHeading: { paddingHorizontal: GUTTER, marginBottom: space[3] },
  rail: { paddingHorizontal: GUTTER, gap: space[3] },
  card: {
    width: CARD_WIDTH,
    padding: space[3],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space[3],
  },
  cardTop: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  cardText: { flex: 1 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  cardPlay: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMeter: { flex: 1 },
});
