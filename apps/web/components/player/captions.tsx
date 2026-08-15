'use client';

import { queryKeys } from '@cue/api-client';
import { activeSegmentIndex, seekTargetSec } from '@cue/core';
import type { TranscriptSegment } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { animate, useMotionValue } from 'motion/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { api } from '@/lib/api';
import { usePrefersReducedMotion, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState, readPosition } from '@/lib/player/store';
import { GenerateCaptions } from './generate-captions';

/**
 * The captions, following the audio.
 *
 * **Nothing here re-renders per frame.** A `requestAnimationFrame` loop reads
 * the audio clock and asks which line is active, but React state is written
 * only when that answer *changes* — roughly once every few seconds of speech.
 *
 * **The scroll is a spring, not `scrollIntoView`.** The browser's smooth scroll
 * is a fixed-duration ease with no interruption model: ask it to scroll again
 * before it has finished and implementations variously queue, restart, or jump.
 * Since a caption advances every few seconds, that was happening constantly,
 * and it is why the old version stuttered. Here the scroll offset is a
 * `MotionValue` driven by the same spring vocabulary as everything else, so a
 * new target mid-flight is picked up with the current position *and velocity*
 * carried into it — the list changes course rather than starting again.
 */

/**
 * Where the line being spoken sits, as a fraction of the column.
 *
 * Not the middle. Reading runs forward, so the useful half of the column is
 * the half below the active line — anchoring at 0.5 spends as much space on
 * what has already been said as on what is coming. Apple lands around a third
 * of the way down and it is the right answer for the same reason.
 */
const ANCHOR = 0.36;

export function Captions({ episodeId, className }: { episodeId: string; className?: string }) {
  const t = useTranslator();
  const state = usePlayerState();
  const { seek } = usePlayerActions();
  const reduced = usePrefersReducedMotion();
  const glide = useTransition('gentle');

  const [activeIndex, setActiveIndex] = useState(-1);

  /**
   * Always asked for, never gated on the episode declaring a transcript URL.
   *
   * The episode page gates on `transcriptUrl` to avoid a pointless request, and
   * that assumption is wrong here: a transcript Cue generated itself is stored
   * against an episode whose `transcriptUrl` is null, because no publisher ever
   * offered one. Gating on it hid every generated transcript behind a "no
   * captions" screen offering to generate the transcript that already existed.
   *
   * The cost of asking anyway is one indexed read when there is nothing.
   */
  const { data, isPending } = useQuery({
    queryKey: queryKeys.episode.transcript(episodeId),
    queryFn: ({ signal }) => api.getTranscript(episodeId, { signal }),
    // A published transcript does not change, and a miss costs a fetch from the
    // publisher's CDN. Not worth repeating for the life of the session.
    staleTime: Infinity,
  });

  const transcript = data?.transcript ?? null;
  const segments = useMemo(() => transcript?.segments ?? [], [transcript]);

  /**
   * Whether these captions can follow the audio at all.
   *
   * Publishers overwhelmingly ship untimed HTML prose. That is worth reading
   * and cannot be scrolled in time with speech, so the highlight and the
   * auto-scroll are withheld rather than shown doing nothing — an inert
   * control is worse than one that was never offered.
   */
  const timed = transcript?.timed ?? false;
  const isCurrent = state.current?.id === episodeId;
  const playing = isCurrent && state.status === 'playing';

  /**
   * Follow the audio.
   *
   * `lastRef` rather than comparing against `activeIndex` directly, so the
   * effect does not need the state in its dependency list and tear the loop
   * down and rebuild it on every line change.
   */
  const lastRef = useRef(-1);

  useEffect(() => {
    if (!timed || !isCurrent || segments.length === 0) return;

    let frame = 0;
    const tick = () => {
      const next = activeSegmentIndex(segments, readPosition() * 1000);
      if (next !== lastRef.current) {
        lastRef.current = next;
        setActiveIndex(next);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timed, isCurrent, segments]);

  // Paused, the position still moves on a seek, so read it once when playback
  // settles rather than leaving the highlight where the loop last left it.
  useEffect(() => {
    if (!timed || !isCurrent || playing || segments.length === 0) return;
    const next = activeSegmentIndex(segments, readPosition() * 1000);
    lastRef.current = next;
    setActiveIndex(next);
  }, [timed, isCurrent, playing, segments, state.positionSec]);

  // ------------------------------------------------------- the scroll ------

  const listRef = useRef<HTMLOListElement>(null);

  /**
   * The scroll offset, as a motion value.
   *
   * Writing `scrollTop` from a subscription rather than from React is the same
   * rule the scrubber follows: this changes every frame for the length of an
   * animation, and nothing about it belongs in a render.
   */
  const offset = useMotionValue(0);

  useEffect(() => {
    return offset.on('change', (value) => {
      const list = listRef.current;
      if (list) list.scrollTop = value;
    });
  }, [offset]);

  /**
   * Whether the list is still following the audio.
   *
   * Someone who scrolls back to re-read has said, unambiguously, that they want
   * to be somewhere other than where the spring is taking them, and continuing
   * to drag them forward every few seconds makes re-reading impossible. So the
   * gesture wins, and following resumes on a timer.
   *
   * Listening for wheel and touch rather than for `scroll`: the spring produces
   * scroll events too, and telling the two apart after the fact means a flag
   * that is wrong exactly when it matters.
   */
  const followingRef = useRef(true);
  const resumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const yieldToReader = () => {
      followingRef.current = false;
      // Hand the spring the position the reader actually left it at, so when
      // following resumes it eases on from here rather than from wherever it
      // was when they took over.
      offset.jump(list.scrollTop);

      if (resumeRef.current) clearTimeout(resumeRef.current);
      resumeRef.current = setTimeout(() => {
        followingRef.current = true;
      }, 6000);
    };

    list.addEventListener('wheel', yieldToReader, { passive: true });
    list.addEventListener('touchmove', yieldToReader, { passive: true });

    return () => {
      list.removeEventListener('wheel', yieldToReader);
      list.removeEventListener('touchmove', yieldToReader);
      if (resumeRef.current) clearTimeout(resumeRef.current);
    };
  }, [offset]);

  /**
   * Put the active line on the anchor.
   *
   * Measured twice — now, and again on the next frame. The column's own
   * padding is set from a height measured in an effect, so the first pass after
   * mount computes against a list that has not been given its end padding yet;
   * a web font swapping in reflows every line for the same reason. The second
   * measurement lands after layout has settled, and because the spring is
   * retargeted rather than restarted, the correction reads as a change of
   * course rather than as a jump.
   */
  const scrollToActive = useCallback(
    (index: number, animated: boolean) => {
      const list = listRef.current;
      if (!list || index < 0) return;

      const line = list.querySelector<HTMLElement>(`[data-line="${index}"]`);
      if (!line) return;

      const target = line.offsetTop + line.offsetHeight / 2 - list.clientHeight * ANCHOR;
      const clamped = Math.max(0, Math.min(target, list.scrollHeight - list.clientHeight));

      if (!animated) {
        offset.jump(clamped);
        return;
      }

      // Start from where the list actually is. If a reader scrolled and the
      // resume timer has just fired, the motion value and the DOM disagree.
      if (Math.abs(offset.get() - list.scrollTop) > 1) offset.jump(list.scrollTop);
      animate(offset, clamped, glide);
    },
    [offset, glide],
  );

  useEffect(() => {
    if (activeIndex < 0 || !followingRef.current) return;

    scrollToActive(activeIndex, !reduced);
    const frame = requestAnimationFrame(() => scrollToActive(activeIndex, !reduced));
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, reduced, scrollToActive]);

  /**
   * Half a column of padding at each end, measured rather than guessed.
   *
   * The first and last lines have to be able to reach the anchor, which means
   * padding proportional to the column's *height*. Percentage padding resolves
   * against width, so this is the one thing here that has to be measured.
   *
   * `clientHeight`, deliberately, and not the observer's `contentRect`. The
   * padding this computes is a full column tall, and with `border-box` sizing
   * it comes out of the content box — so feeding `contentRect.height` back in
   * would shrink the measurement that produced it, and the whole thing
   * converges on zero. `clientHeight` counts the padding box, so it stays put.
   */
  const [columnHeight, setColumnHeight] = useState(0);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const observer = new ResizeObserver(() => setColumnHeight(list.clientHeight));
    observer.observe(list);
    setColumnHeight(list.clientHeight);
    return () => observer.disconnect();
  }, [transcript]);

  /**
   * Seeking, without a new closure per line per render.
   *
   * `usePlayerActions` hands back a fresh object every render, so passing
   * `seek` down directly would give every line a new prop four times a second
   * and defeat the memo below.
   */
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const onSeek = useCallback((sec: number) => seekRef.current(sec), []);

  /**
   * The lines, rebuilt only when something about them changed.
   *
   * Without this the list is rebuilt on every position report — four times a
   * second, creating one element per segment each time. On a long transcript
   * that is thousands of allocations a second to move one highlight, and it is
   * the kind of cost that never shows up as a single slow frame, just as a
   * screen that never feels quite smooth.
   */
  const lines = useMemo(
    () =>
      segments.map((segment) => (
        <Line
          key={segment.index}
          segment={segment}
          distance={timed ? bucket(segment.index, activeIndex) : null}
          onSelect={timed && isCurrent ? () => onSeek(seekTargetSec(segment)) : null}
        />
      )),
    [segments, timed, activeIndex, isCurrent, onSeek],
  );

  // ------------------------------------------------------------- states --

  if (isPending) {
    return (
      <Shell className={className}>
        <p className="type-body text-[var(--color-text-tertiary)]">{t.t('transcript.loading')}</p>
      </Shell>
    );
  }

  if (!transcript || transcript.status === 'failed' || segments.length === 0) {
    return (
      <Shell className={className}>
        <GenerateCaptions episodeId={episodeId} detail={data?.detail ?? null} />
      </Shell>
    );
  }

  return (
    <ol
      ref={listRef}
      aria-label={t.t('transcript.title')}
      style={{
        /**
         * The caption size lives here, on the list, and the lines inherit it.
         *
         * It has to, because the measure below is in `ch` and `ch` resolves
         * against the font size of the element it is written on. Set on the
         * lines instead, the list was still 15px UI text, and a 34-character
         * measure came out around 250px — the captions wrapped every three or
         * four words and read as a column of fragments.
         *
         * Deliberately not a type token. Every size in the scale is for reading
         * at arm's length in a dense screen; this is read at a glance, from
         * further away, as the only text on its half of the window. It is also
         * the one place whose size should follow the window, because the column
         * it lives in does.
         */
        fontSize: 'clamp(1.375rem, 1.9vw, 1.875rem)',
        paddingBlockStart: columnHeight * ANCHOR,
        paddingBlockEnd: columnHeight * (1 - ANCHOR),
        // The column fades out rather than being cut off by the edge of the
        // sheet, so lines leave the way speech does. Weighted to keep the
        // anchor and everything below it fully opaque.
        maskImage:
          'linear-gradient(to bottom, transparent 0%, #000 13%, #000 84%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, #000 13%, #000 84%, transparent 100%)',
        // Scroll anchoring exists to stop content shifting under a reader, and
        // here it fights the spring: as lines below the fold take their real
        // height the browser "helpfully" compensates, which lands the active
        // line somewhere other than the anchor.
        overflowAnchor: 'none',
      }}
      className={[
        'm-0 h-full list-none overflow-y-auto overscroll-contain',
        // The measure is the point of the column. A caption running the full
        // width of a wide window is a line of body text in a large font, not a
        // lyric — the eye has to travel too far to find the next one, and the
        // shape stops reading as speech.
        'w-full max-w-[34ch] ps-1 pe-4',
        'scrollbar-none',
        className ?? '',
      ].join(' ')}
    >
      {lines}
    </ol>
  );
}

/**
 * How far this line is from the one being spoken, in four steps.
 *
 * Bucketed rather than exact so a line's rendered appearance changes a handful
 * of times across an entire episode. An exact distance would give every line in
 * the transcript new props on every advance.
 */
function bucket(index: number, active: number): 0 | 1 | 2 | 3 {
  if (active < 0) return 3;
  const away = Math.abs(index - active);
  if (away === 0) return 0;
  if (away === 1) return 1;
  if (away <= 3) return 2;
  return 3;
}

/**
 * Opacity, blur and scale per step.
 *
 * The blur radii are deliberately small. Blurring text is one of the most
 * expensive things a browser can be asked to do — the glyphs are rasterised to
 * a texture and then convolved, and a CSS transition on `filter` does it again
 * on every frame of the transition. At the old radii, five lines changing depth
 * at once was enough to lose frames on the exact interaction this screen exists
 * for. Most of the depth is carried by opacity and scale, which cost nothing,
 * and the blur is left only as the finishing touch it should have been.
 */
const DEPTH = {
  0: { opacity: 1, blur: 0, scale: 1 },
  1: { opacity: 0.4, blur: 0.7, scale: 0.965 },
  2: { opacity: 0.26, blur: 1.4, scale: 0.955 },
  3: { opacity: 0.16, blur: 2, scale: 0.95 },
} as const;

const Line = memo(function Line({
  segment,
  distance,
  onSelect,
}: {
  segment: TranscriptSegment;
  /** Null when the transcript carries no timings — every line reads the same. */
  distance: 0 | 1 | 2 | 3 | null;
  onSelect: (() => void) | null;
}) {
  const depth = distance === null ? { opacity: 0.85, blur: 0, scale: 1 } : DEPTH[distance];

  const content = (
    <span
      className="block transition-[opacity,filter,transform] duration-[var(--duration-slow)] ease-standard"
      style={{
        opacity: depth.opacity,
        // Grown from the start edge rather than the centre: scaling about the
        // middle makes the text drift sideways as it advances, and the reader's
        // eye is holding the start of the line.
        transform: `scale(${depth.scale})`,
        transformOrigin: 'left center',
        filter: depth.blur ? `blur(${depth.blur}px)` : undefined,
      }}
    >
      {segment.text}
    </span>
  );

  return (
    <li
      data-line={segment.index}
      // Size is inherited from the list, which is where it has to be set for
      // the measure to resolve. Everything else about the line lives here.
      style={{ lineHeight: 1.28, letterSpacing: '-0.02em' }}
      // Spacing in `em` so the rhythm holds as the size follows the window.
      // Generous on purpose: the gap is what keeps a handful of lines on screen
      // rather than a wall of them, which is the difference between reading
      // along with speech and reading a transcript.
      className="my-[0.72em] font-bold text-[var(--color-text-primary)]"
    >
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          className="w-full cursor-pointer border-0 bg-transparent p-0 text-start font-[inherit] text-[inherit] leading-[inherit] tracking-[inherit]"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
});

function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={['flex h-full flex-col items-start justify-center px-1', className ?? ''].join(' ')}
    >
      {children}
    </div>
  );
}
