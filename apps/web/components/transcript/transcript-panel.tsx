'use client';

import { queryKeys } from '@cue/api-client';
import {
  activeSegmentIndex,
  formatTimestamp,
  playableFromEpisode,
  searchSegments,
  seekTargetSec,
} from '@cue/core';
import type { Translator } from '@cue/i18n';
import type { Episode, TranscriptSegment } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { animate, useMotionValue } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useTranslator } from '@/components/i18n/locale-provider';
import { usePrefersReducedMotion, useTransition } from '@/lib/motion';
import { useOnScreen } from '@/lib/on-screen';
import { attachTranscriptReader } from '@/lib/transcript-reader';
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
  const { seek, playAt } = usePlayerActions();
  const reduced = usePrefersReducedMotion();
  const glide = useTransition('gentle');

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.episode.transcript(episode.id),
    queryFn: ({ signal }) => api.getTranscript(episode.id, { signal }),
    // A publisher's transcript does not change once published. This is a real
    // network round trip and, on a miss, a fetch from their CDN — worth not
    // repeating for the life of the session.
    staleTime: Infinity,
    /*
      Asked for unconditionally, which it was not.

      This was `enabled: Boolean(episode.transcriptUrl)` — a sensible-looking
      guard against a pointless request, resting on an assumption that is
      false: a transcript *Cue generated itself* is stored against an episode
      whose `transcriptUrl` is null, because no publisher ever offered one. So
      the feature worked in the player, where `Captions` deliberately does not
      gate (and says so), and was invisible on the one page whose job is to
      show it. The early return below had the same fault and has gone with it.

      The cost of asking anyway is one indexed read when there is nothing.
    */
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
  const [panelElement, setPanelElement] = useState<HTMLElement | null>(null);
  const onScreen = useOnScreen(panelElement);

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
   * Keep the active line in view — inside this panel, and only while the reader
   * is not reading something else.
   *
   * What this replaces was one line, `line.scrollIntoView({ block: 'center' })`,
   * and it was wrong in the two ways that matter most on a transcript.
   *
   * **It scrolled the page, not the panel.** The list was not its own scroll
   * container, and `scrollIntoView` moves every scrollable ancestor — so every
   * few seconds of playback the whole episode page slid under the reader, who
   * might have been half way through the show notes. The container below is
   * what confines it.
   *
   * **It had no way to yield.** The player's caption column has had one for as
   * long as it has existed: touch or wheel means the reader has said,
   * unambiguously, that they want to be somewhere other than where the
   * playhead is, and dragging them forward again makes re-reading impossible.
   * Six seconds later it resumes. That is ported here rather than reinvented —
   * the two columns answer the same question and should not answer it
   * differently.
   *
   * The travel is a retargetable spring for the reason `captions.tsx` gives:
   * the browser's smooth scroll is a fixed-duration ease with no interruption
   * model, and a new target mid-flight is variously queued, restarted or
   * jumped depending on the implementation. A line advances every few seconds,
   * so that was happening constantly.
   */
  const listRef = useRef<HTMLOListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const mountScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    setScrollElement(element);
  }, []);
  const offset = useMotionValue(0);

  useEffect(() => {
    return offset.on('change', (value) => {
      const box = scrollRef.current;
      if (box) box.scrollTop = value;
    });
  }, [offset]);

  /**
   * Whether the panel is still following the audio.
   *
   * Listening for `wheel` and `touchmove` rather than for `scroll`, because the
   * spring produces scroll events too — telling the two apart after the fact
   * means a flag that is wrong exactly when it matters.
   */
  const followingRef = useRef(true);

  useEffect(() => {
    const box = scrollElement;
    if (!box) return;

    return attachTranscriptReader(box, followingRef, (position) => offset.jump(position), RESUME_FOLLOWING_MS);
  }, [offset, scrollElement]);

  useEffect(() => {
    if (!onScreen || !playing || activeIndex < 0) return;
    if (!followingRef.current) return;

    const box = scrollRef.current;
    const line = listRef.current?.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`);
    if (!box || !line) return;

    /*
      Measured from rectangles rather than from `offsetTop`.

      `offsetTop` is relative to the nearest *positioned* ancestor, which is not
      necessarily the scroll container — on this page it was the tinted page
      wrapper, so the first computed target included the whole page header and
      the panel scrolled fifteen hundred pixels to reach its second line.
      Rectangle differences are relative to the box being scrolled by
      construction, and cannot be broken by adding or removing a `relative`
      somewhere in between.
    */
    const boxTop = box.getBoundingClientRect().top;
    const lineBox = line.getBoundingClientRect();
    const target =
      box.scrollTop + (lineBox.top - boxTop) - (box.clientHeight - lineBox.height) / 2;
    const clamped = Math.max(0, Math.min(target, box.scrollHeight - box.clientHeight));

    /*
      A cut rather than a glide when the playhead has genuinely moved.

      Gliding is right for one line to the next and wrong for a seek, which can
      be an hour of transcript away: springing across that flings the column
      through thousands of lines of somebody else's conversation at a speed
      nobody can read. Past a certain size a movement is a discontinuity, and a
      cut is the honest way to draw one — the same rule the caption column and
      the playback clock both follow.
    */
    if (reduced || Math.abs(clamped - offset.get()) > box.clientHeight * 2) {
      offset.jump(clamped);
      box.scrollTop = clamped;
      return;
    }

    // Re-anchored only on a large disagreement: `scrollTop` is quantised by the
    // browser while the motion value is not, so the two routinely differ by
    // about a pixel mid-glide — and `jump` resets velocity, which would stop
    // the spring dead several times on the way to every line.
    if (Math.abs(offset.get() - box.scrollTop) > 24) offset.jump(box.scrollTop);

    const controls = animate(offset, clamped, glide);
    return () => controls.stop();
  }, [onScreen, activeIndex, playing, reduced, offset, glide]);

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

      void playAt(playable, target);
    },
    [isCurrent, seek, playAt, episode, podcastTitle, podcastArtworkUrl, accentColor],
  );

  /*
    Nothing at all, rather than a heading over an apology.

    The episode page used to decide this for itself, by rendering the whole
    section only when `episode.transcriptUrl` was set — which is what hid every
    generated transcript. Moving the decision in here is what lets the answer
    depend on whether a transcript *exists* rather than on where it came from,
    and the page above is now free of the question entirely.

    Pending renders nothing too. This sits at the very bottom of the page, so
    there is nothing below it to push down; a heading that appears, says
    "Loading the transcript…", and then removes itself again for the majority
    of episodes that have none is worse than a section that simply arrives.
  */
  if (isPending) return null;
  if (error) return <Section t={t}><Empty>{t.t('transcript.failed')}</Empty></Section>;

  if (!transcript || transcript.status === 'failed' || segments.length === 0) {
    return null;
  }

  return (
    <section ref={setPanelElement} className="mt-10" aria-label={t.t('transcript.title')}>
      <h2 className="type-title3 mt-0 mb-4 text-[var(--color-text-primary)]">
        {t.t('transcript.title')}
      </h2>
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

      {/*
        The panel scrolls, the page does not.

        Bounded so that following the audio moves this column and nothing else —
        the whole reason the old `scrollIntoView` was disruptive was that the
        list had no scroll container of its own, so the browser obligingly moved
        the outermost one it could find. `overscroll-contain` stops a flick at
        the end of the transcript continuing into the page behind it.

        `70vh` rather than a fixed height: a transcript is a companion to the
        episode page, not a replacement for it, and leaving a strip of the page
        visible above and below is what says so.
      */}
      <div
        ref={mountScroll}
        className="max-h-[70vh] overflow-y-auto overscroll-contain rounded-[var(--radius-md)]"
        style={{
          // Scroll anchoring compensates as off-screen lines take their real
          // height, which lands the active line somewhere other than the middle
          // — the same fight the caption column documents.
          overflowAnchor: 'none',
        }}
      >
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
      </div>
    </section>
  );
}

/** How long a manual scroll holds the panel before it follows the audio again. */
const RESUME_FOLLOWING_MS = 6000;

/** The heading, for the one state that has something to say and no list. */
function Section({ t, children }: { t: Translator; children: React.ReactNode }) {
  return (
    <section className="mt-10" aria-label={t.t('transcript.title')}>
      <h2 className="type-title3 mt-0 mb-4 text-[var(--color-text-primary)]">
        {t.t('transcript.title')}
      </h2>
      {children}
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
