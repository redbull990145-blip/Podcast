import { queryKeys, staleTime } from '@cue/api-client';
import {
  activeSegmentIndex,
  formatTimestamp,
  playableFromEpisode,
  searchSegments,
  seekTargetSec,
} from '@cue/core';
import { icon } from '@cue/design';
import type { TranscriptSegment } from '@cue/types';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/icon';
import { MiniPlayer } from '@/components/mini-player';
import { PressableScale } from '@/components/pressable-scale';
import { ScreenMessage } from '@/components/screen-message';
import { api } from '@/lib/api';
import { playerActions, readPosition, usePlayerState } from '@/lib/player/store';
import { MINI_PLAYER_HEIGHT, radius, space, type, useTheme } from '@/theme';

/**
 * How often the playhead is read while following along.
 *
 * The web panel does this on `requestAnimationFrame`, where reading the
 * position is a property access on an `<audio>` element already on the main
 * thread. Here every read crosses into the native player, and a transcript is
 * a screen people scroll — so sixty reads a second would be competing with the
 * list for the JS thread to move a highlight that changes roughly once every
 * three seconds.
 *
 * Four a second puts the highlight at most 250ms behind the spoken word, which
 * against a line that lasts twelve times that long is not perceptible. The
 * engine's own reports come at 500ms and are the wrong source for this: they
 * would double the worst case, and land the highlight visibly late on short
 * lines.
 */
const POLL_MS = 250;

/**
 * The transcript.
 *
 * Its own screen rather than a section of the episode page, which is the one
 * real structural difference from the web. A transcript runs to thousands of
 * lines, and the episode screen is a `ScrollView` — nesting a virtualized list
 * inside one breaks recycling and mounts the whole transcript anyway, so the
 * list needs a screen it can own.
 *
 * Virtualized here, where the web deliberately is not. That was not a
 * platform-blind decision: the web keeps every line mounted so the browser's
 * find-in-page can reach the whole document. Android has no find-in-page — the
 * search field below *is* the only search — so the reason not to virtualize
 * does not exist here, and the reason to does.
 */
export default function TranscriptScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduced = useReducedMotion();
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = usePlayerState();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  /**
   * Whether the list is still tracking the playhead.
   *
   * Follow-along is the point of the screen, but on a touch surface the reader's
   * thumb is on the very thing that moves. Scrolling away has to mean "I am
   * reading here now" or the list drags them back mid-sentence, which is worse
   * than never having followed at all.
   */
  const [following, setFollowing] = useState(true);

  const { data: episodeData, error: episodeError, isPending: episodePending } = useQuery({
    queryKey: queryKeys.episode.detail(id),
    queryFn: () => api.getEpisode(id),
    staleTime: staleTime.episodes,
  });

  const episode = episodeData?.episode;

  const { data: podcastData } = useQuery({
    queryKey: queryKeys.podcast.detail(episode?.podcastId ?? ''),
    queryFn: () => api.getPodcast(episode!.podcastId),
    enabled: Boolean(episode?.podcastId),
    staleTime: staleTime.podcast,
  });

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.episode.transcript(id),
    queryFn: ({ signal }) => api.getTranscript(id, { signal }),
    // A published transcript does not change. On a metered connection this is
    // worth fetching once and not again.
    staleTime: Infinity,
    enabled: Boolean(episode?.transcriptUrl),
  });

  const transcript = data?.transcript ?? null;
  const segments = useMemo(() => transcript?.segments ?? [], [transcript]);

  /**
   * Whether this transcript carries real timecodes.
   *
   * Publishers overwhelmingly ship HTML prose with none, and those can be read
   * but cannot be followed. Timestamps, tap-to-seek and the highlight are all
   * withheld for them rather than shown doing nothing.
   */
  const timed = transcript?.timed ?? false;

  const isCurrent = state.current?.id === id;
  const playing = isCurrent && state.status === 'playing';
  const searching = query.trim().length > 0;

  /**
   * Follow the audio.
   *
   * `lastRef` rather than comparing against `activeIndex`, so the interval does
   * not need the state in its dependencies and get torn down and rebuilt every
   * time the line changes.
   */
  const lastRef = useRef(-1);

  useEffect(() => {
    if (!timed || !isCurrent || segments.length === 0) return;

    const check = () => {
      const next = activeSegmentIndex(segments, readPosition() * 1000);
      if (next === lastRef.current) return;
      lastRef.current = next;
      setActiveIndex(next);
    };

    // Immediately, so opening the screen mid-episode lands on the right line
    // rather than a quarter-second of nothing.
    check();

    const timer = setInterval(check, POLL_MS);
    return () => clearInterval(timer);
  }, [timed, isCurrent, segments]);

  const matches = useMemo(
    () => (searching ? searchSegments(segments, query) : null),
    [segments, query, searching],
  );

  const shown = matches ?? segments;

  const listRef = useRef<FlashListRef<TranscriptSegment>>(null);

  /**
   * Keep the active line in view.
   *
   * Suspended while a search is open: the list is showing matches then, whose
   * positions have nothing to do with the playhead's, and scrolling it would
   * throw away the results the reader is looking at.
   */
  useEffect(() => {
    if (!following || !playing || searching || activeIndex < 0) return;
    if (activeIndex >= segments.length) return;

    listRef.current?.scrollToIndex({
      index: activeIndex,
      // Reduced motion still moves the list — it just stops travelling to do it.
      animated: !reduced,
      // Above centre: the line being spoken sits where the eye already is, with
      // what comes next visible below it rather than off-screen.
      viewPosition: 0.35,
    });
  }, [activeIndex, following, playing, searching, reduced, segments.length]);

  /**
   * Tapping a line.
   *
   * When this is the episode playing, it moves the playhead. When it is not, it
   * *starts* this episode there — the alternative is seeking whatever happens to
   * be playing to a timestamp from a different show, which is silently wrong in
   * the worst way: it does something, and the something is not what was asked.
   */
  const onSelect = useCallback(
    (segment: TranscriptSegment) => {
      const target = seekTargetSec(segment);

      if (isCurrent) {
        playerActions.seek(target);
        return;
      }

      if (!episode) return;

      const playable = playableFromEpisode(episode, {
        title: podcastData?.podcast.title ?? '',
        artworkUrl: podcastData?.podcast.artworkUrl ?? null,
        accentColor: podcastData?.podcast.accentColor ?? null,
      });

      void playerActions.play(playable).then(() => {
        // After the load rather than as part of it: `play` resolves the stored
        // resume position, and resume rules would rewrite an explicit target
        // (rewinding it, or zeroing it near the end of the episode).
        playerActions.seek(target);
      });

      setFollowing(true);
    },
    [isCurrent, episode, podcastData],
  );

  const renderItem = useCallback(
    ({ item }: { item: TranscriptSegment }) => (
      <Line
        segment={item}
        active={timed && !searching && item.index === activeIndex}
        onSelect={timed ? onSelect : null}
      />
    ),
    [timed, searching, activeIndex, onSelect],
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space[2] }]}>
      <PressableScale
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={space[3]}
        scale={0.9}
        style={styles.back}
      >
        <View style={styles.backIcon}>
          <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
        </View>
      </PressableScale>

      <View style={styles.headerText}>
        <Text style={[type('overline'), { color: theme.textTertiary }]}>TRANSCRIPT</Text>
        {episode ? (
          <Text numberOfLines={1} style={[type('bodyStrong'), { color: theme.textPrimary }]}>
            {episode.title}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const body = () => {
    if (episodeError) {
      return (
        <ScreenMessage
          title="Couldn't load this episode"
          body="The publisher may have removed it, or the connection dropped."
        />
      );
    }

    if (episodePending) return <ScreenMessage title="Loading…" />;

    if (!episode?.transcriptUrl) {
      return (
        <ScreenMessage
          title="No transcript"
          body="This publisher doesn’t offer one for this episode."
        />
      );
    }

    if (isPending) return <ScreenMessage title="Loading the transcript…" />;

    if (error) {
      return (
        <ScreenMessage
          title="Couldn't load the transcript"
          body="Check the connection and try again."
        />
      );
    }

    if (!transcript || transcript.status === 'failed' || segments.length === 0) {
      return (
        <ScreenMessage
          title="No transcript"
          body={data?.detail ?? 'Nothing readable came back from the publisher.'}
        />
      );
    }

    return (
      <>
        <View style={styles.search}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search this transcript…"
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel="Search this transcript"
            returnKeyType="search"
            style={[
              type('callout'),
              styles.input,
              {
                color: theme.textPrimary,
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}
          />

          {matches ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[type('caption'), { color: theme.textSecondary }]}
            >
              {matches.length === 0
                ? 'No matches'
                : `${matches.length} ${matches.length === 1 ? 'line' : 'lines'}`}
            </Text>
          ) : null}
        </View>

        <FlashList
          ref={listRef}
          data={shown}
          extraData={activeIndex}
          keyExtractor={(segment) => String(segment.index)}
          renderItem={renderItem}
          // Only a real drag disengages following — a programmatic scroll from
          // the follow effect itself must not be mistaken for one.
          onScrollBeginDrag={() => {
            if (!searching) setFollowing(false);
          }}
          contentContainerStyle={{
            paddingHorizontal: space[5],
            paddingBottom: insets.bottom + space[10] + (state.current ? MINI_PLAYER_CLEARANCE : 0),
          }}
        />
      </>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {header}
      {body()}

      {/* Resume following. Only offered when there is something to resume to —
          it is playing, this is the episode, and the reader has scrolled off. */}
      {timed && playing && !following && !searching ? (
        <PressableScale
          onPress={() => setFollowing(true)}
          accessibilityRole="button"
          accessibilityLabel="Follow the audio"
          scale={0.95}
          style={[
            styles.follow,
            {
              bottom: insets.bottom + space[4] + (state.current ? MINI_PLAYER_CLEARANCE : 0),
              backgroundColor: theme.accent,
            },
          ]}
        >
          <Text style={[type('caption'), { color: theme.textOnAccent }]}>Follow</Text>
        </PressableScale>
      ) : null}

      {/* Reading along and being unable to pause without leaving the screen is
          the gap the web does not have — it keeps its player bar in view the
          whole time. */}
      <MiniPlayer bottomOffset={0} />
    </View>
  );
}

/**
 * Height the mini player occupies, plus its gap, for keeping content clear of
 * it. Derived from the shared constant rather than restating it — a number
 * duplicated here would drift the first time either one moved.
 */
const MINI_PLAYER_CLEARANCE = MINI_PLAYER_HEIGHT + 2;

function Line({
  segment,
  active,
  onSelect,
}: {
  segment: TranscriptSegment;
  active: boolean;
  /** Null when the transcript has no timings — which is what makes it prose. */
  onSelect: ((segment: TranscriptSegment) => void) | null;
}) {
  const theme = useTheme();

  // Untimed prose is text, not a control. A row that announces itself as a
  // button and then does nothing is worse for a screen reader than a paragraph.
  if (!onSelect) {
    return (
      <View style={styles.prose}>
        {segment.speaker ? (
          <Text style={[type('caption'), { color: theme.textTertiary, marginBottom: 2 }]}>
            {segment.speaker}
          </Text>
        ) : null}
        <Text style={[type('body'), { color: theme.textSecondary }]}>{segment.text}</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onSelect(segment)}
      accessibilityRole="button"
      accessibilityLabel={`Play from ${formatTimestamp(segment.startMs / 1000)}. ${segment.text}`}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.line,
        {
          backgroundColor: active
            ? theme.accentMuted
            : pressed
              ? theme.surfaceHover
              : 'transparent',
        },
      ]}
    >
      {/* Fixed column, so the timestamps do not shuffle sideways as the digits
          change down the page. */}
      <Text
        style={[
          type('caption'),
          styles.stamp,
          { color: active ? theme.accentText : theme.textTertiary },
        ]}
      >
        {formatTimestamp(segment.startMs / 1000)}
      </Text>

      <View style={styles.lineText}>
        {segment.speaker ? (
          <Text style={[type('caption'), { color: theme.textSecondary, marginBottom: 2 }]}>
            {segment.speaker}
          </Text>
        ) : null}
        <Text
          style={[type('body'), { color: active ? theme.textPrimary : theme.textSecondary }]}
        >
          {segment.text}
        </Text>
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
    paddingHorizontal: space[3],
    paddingBottom: space[3],
  },
  back: { padding: space[2] },
  backIcon: { transform: [{ rotate: '90deg' }] },
  headerText: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingBottom: space[4],
  },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  prose: { marginBottom: space[4] },
  line: {
    flexDirection: 'row',
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  stamp: { width: 46, textAlign: 'right', paddingTop: 2 },
  lineText: { flex: 1 },
  follow: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: space[4],
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.full,
  },
});
