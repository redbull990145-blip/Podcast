'use client';

import { queryKeys } from '@cue/api-client';
import {
  activeSegmentIndex,
  formatTimestamp,
  playableFromEpisode,
  searchSegments,
  seekTargetSec,
} from '@cue/core';
import type { Episode, TranscriptSegment } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useTranslator } from '@/components/i18n/locale-provider';
import { usePrefersReducedMotion } from '@/lib/motion';
import { useOnScreen } from '@/lib/on-screen';
import { useFrameLoop } from '@/lib/player/frame-clock';
import { readPosition, usePlayerActions, usePlayerSelector } from '@/lib/player/store';

/**
 * The transcript, following along.
 *
 * **The highlight is not driven by React state per frame.** A `requestAnimation
 * Frame` loop reads the audio clock and asks which line is active, but the
 * answer only *changes* about once every three seconds — so state is written
 * on the transition, not on the tick. At 120Hz the difference is two renders a
 * second against two hundred and forty.
 *
 * Every line stays in the DOM rather than being virtualized. A transcript is
 * the one screen where the browser's own find-in-page is the feature people
 * reach for first, and a windowed list silently breaks it — Ctrl+F would search
 * the forty lines that happen to be mounted. `content-visibility` gets the
 * rendering cost of virtualization while keeping the document whole.
 */
export function TranscriptPanel({
  episode,
  podcastTitle,
  podcastArtworkUrl,
  accentColor,
}: {
  episode: Episode;
  /** The show, for the case where a tap has to *start* this episode. */
  podcastTitle: string;
  podcastArtworkUrl: string | null;
  accentColor: string | null;
}) {
  const t = useTranslator();
  /**
   * Primitives rather than the whole snapshot — the same reasoning as the note
   * in `captions.tsx`. This panel renders one element per cue and the player
   * re-emits several times a second, so subscribing to everything made every
   * tick a re-render of the entire transcript.
   */
  const isCurrent = usePlayerSelector((s) => s.current?.id === episode.id);
  const playing = usePlayerSelector(
    (s) => s.current?.id === episode.id && s.status === 'playing',
  );
  /** Position only while paused, so a seek still moves the highlight. */
  const pausedPositionSec = usePlayerSelector((s) =>
    s.status === 'playing' ? 0 : s.positionSec,
  );
  const { seek, play } = usePlayerActions();
  const reduced = usePrefersReducedMotion();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.episode.transcript(episode.id),
    queryFn: ({ signal }) => api.getTranscript(episode.id, { signal }),
    // A publisher's transcript does not change once published. This is a real
    // network round trip and, on a miss, a fetch from their CDN — worth not
    // repeating for the life of the session.
    staleTime: Infinity,
    enabled: Boolean(episode.transcriptUrl),
  });

  const transcript = data?.transcript ?? null;
  const segments = useMemo(() => transcript?.segments ?? [], [transcript]);

  /**
   * Whether this transcript can follow the audio at all.
   *
   * Publishers overwhelmingly ship `text/html` prose with no timecodes. Those
   * are worth reading and cannot be followed, so the timestamp column, the
   * click-to-seek and the highlight are all withheld rather than shown doing
   * nothing. A control that is present and inert is worse than one that was
   * never offered.
   */
  const timed = transcript?.timed ?? false;

  /** Whether the player is on *this* episode — a transcript only follows its own. */

  /**
   * Follow the audio.
   *
   * The loop runs every frame; `setActiveIndex` fires only when the answer
   * differs from the last one. `lastRef` rather than comparing against
   * `activeIndex` directly, so the effect does not need the state in its
   * dependency list and restart on every change.
   */
  const lastRef = useRef(-1);

  /**
   * Where this panel is, so it can stop working when nobody is looking at it.
   *
   * The episode page renders this *and* the player's caption column, and both
   * follow the same playhead through the same transcript. Whichever one is off
   * screen is spending a frame loop, a state update per spoken line, and a
   * re-render of every cue to move a highlight nobody can see. Measured with
   * audio playing on an 824-cue episode, the two together held the main thread
   * at 85% busy; paused, it was 0%.
   */
  const panelRef = useRef<HTMLElement>(null);
  const onScreen = useOnScreen(panelRef);

  useFrameLoop(onScreen && timed && isCurrent && segments.length > 0, () => {
    const next = activeSegmentIndex(segments, readPosition() * 1000);
    if (next !== lastRef.current) {
      lastRef.current = next;
      setActiveIndex(next);
    }
  });

  // Paused, the position still moves on a seek, so read it once when playback
  // settles rather than leaving the highlight where the loop last left it.
  useEffect(() => {
    if (!timed || !isCurrent || playing || segments.length === 0) return;
    const next = activeSegmentIndex(segments, readPosition() * 1000);
    lastRef.current = next;
    setActiveIndex(next);
  }, [timed, isCurrent, playing, segments, pausedPositionSec]);

  /**
   * Keep the active line in view — but only while it is moving on its own.
   *
   * Scrolling the reader's view is an interruption if they went looking
   * somewhere else, so it follows only during playback. Under reduced motion it
   * jumps rather than glides, per the policy: the position still updates, it
   * just stops travelling to get there.
   */
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!onScreen || !playing || activeIndex < 0) return;

    const line = listRef.current?.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`);
    // Smooth `scrollIntoView` on a list this long is not cheap, and off screen
    // it is not anything at all.
    line?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [onScreen, activeIndex, playing, reduced]);

  const matches = useMemo(
    () => (query.trim() ? searchSegments(segments, query) : null),
    [segments, query],
  );

  const shown = matches ?? segments;

  /**
   * Clicking a line.
   *
   * When this is the episode playing, it moves the playhead. When it is not, it
   * *starts* this episode there — this panel sits on an episode page that can
   * be read while something else is playing, and seeking that to a timestamp
   * from a different show is silently wrong in the worst way: it does
   * something, and the something is not what was asked.
   */
  const onSelect = useCallback(
    (segment: TranscriptSegment) => {
      const target = seekTargetSec(segment);

      if (isCurrent) {
        seek(target);
        return;
      }

      const playable = playableFromEpisode(episode, {
        title: podcastTitle,
        artworkUrl: podcastArtworkUrl,
        accentColor,
      });

      void play(playable).then(() => {
        // After the load rather than as part of it: `play` resolves the stored
        // resume position, and resume rules would rewrite an explicit target
        // (rewinding it, or zeroing it near the end of the episode).
        seek(target);
      });
    },
    [isCurrent, seek, play, episode, podcastTitle, podcastArtworkUrl, accentColor],
  );

  if (!episode.transcriptUrl) {
    return <Empty>{t.t('transcript.noneBody')}</Empty>;
  }

  if (isPending) return <Empty>{t.t('transcript.loading')}</Empty>;

  if (error) return <Empty>{t.t('transcript.failed')}</Empty>;

  if (!transcript || transcript.status === 'failed' || segments.length === 0) {
    return <Empty>{data?.detail ?? t.t('transcript.noneBody')}</Empty>;
  }

  return (
    <section ref={panelRef} aria-label={t.t('transcript.title')}>
      <div className="mb-4 flex items-center gap-3">
        <label className="block flex-1">
          <span className="sr-only">{t.t('transcript.searchLabel')}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            placeholder={t.t('transcript.search')}
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 type-callout text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus-visible:border-[var(--color-accent)]"
          />
        </label>

        {matches ? (
          <p aria-live="polite" className="type-caption shrink-0 text-[var(--color-text-secondary)]">
            {matches.length === 0
              ? t.t('transcript.noMatches')
              : t.t('transcript.matchCount', { count: matches.length })}
          </p>
        ) : null}
      </div>

      <ol ref={listRef} className="m-0 list-none p-0">
        {shown.map((segment) => (
          <Line
            key={segment.index}
            segment={segment}
            active={timed && !matches && segment.index === activeIndex}
            onSeek={timed ? () => onSelect(segment) : null}
          />
        ))}
      </ol>
    </section>
  );
}

function Line({
  segment,
  active,
  onSeek,
}: {
  segment: TranscriptSegment;
  active: boolean;
  /** Null when the transcript has no timings — which is what makes it prose. */
  onSeek: (() => void) | null;
}) {
  // Untimed prose is text, not a control. Rendering it as a disabled button
  // would put every paragraph in the tab order for an action that cannot
  // happen.
  if (!onSeek) {
    return (
      <li
        data-line={segment.index}
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
        className="mb-4"
      >
        {segment.speaker ? (
          <p className="type-caption m-0 mb-1 text-[var(--color-text-tertiary)]">
            {segment.speaker}
          </p>
        ) : null}
        <p className="type-body m-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
          {segment.text}
        </p>
      </li>
    );
  }

  return (
    <li
      data-line={segment.index}
      // Skips layout and paint for lines outside the viewport while leaving
      // them in the document, so find-in-page and screen readers still see the
      // whole transcript. The intrinsic size keeps the scrollbar honest.
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 64px' }}
    >
      <button
        type="button"
        onClick={onSeek}
        aria-current={active ? 'true' : undefined}
        className={[
          'flex w-full cursor-pointer gap-4 border-0 bg-transparent px-2 py-2 text-start',
          'rounded-[var(--radius-sm)] transition-colors',
          active
            ? 'bg-[var(--color-accent-muted)]'
            : 'hover:bg-[var(--color-surface-hover)]',
        ].join(' ')}
      >
        {/* Tabular figures and a fixed column, so the timestamps do not shuffle
            sideways as the digits change down the page. */}
        <span
          className={[
            'type-caption w-12 shrink-0 pt-0.5 text-end',
            active ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-text-tertiary)]',
          ].join(' ')}
        >
          {formatTimestamp(segment.startMs / 1000)}
        </span>

        <span className="min-w-0 flex-1">
          {segment.speaker ? (
            <span className="type-caption me-2 text-[var(--color-text-secondary)]">
              {segment.speaker}
            </span>
          ) : null}
          <span
            className={[
              'type-body max-w-[var(--measure-prose)]',
              active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]',
            ].join(' ')}
          >
            {segment.text}
          </span>
        </span>
      </button>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="type-callout m-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}
