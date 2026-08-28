'use client';

import { queryKeys } from '@cue/api-client';
import {
  activeSegmentIndex,
  canAlign,
  CAPTION_LEAD_MS,
  gapBefore,
  seekTargetSec,
  segmentWords,
  wordProgress,
  type TimedWord,
} from '@cue/core';
import type { TranscriptSegment } from '@cue/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { animate, useMotionValue } from 'motion/react';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { api } from '@/lib/api';
import { usePrefersReducedMotion, useTransition } from '@/lib/motion';
import { useFrameLoop } from '@/lib/player/frame-clock';
import { usePlayerActions, usePlayerSelector, readPosition } from '@/lib/player/store';
import {
  driftMs,
  OFFSET_STEP_MS,
  setCaptionOffsetMs,
  useCaptionOffsetMs,
} from '@/lib/player/caption-sync';
import { GenerateCaptions } from './generate-captions';

/**
 * The captions, following the audio.
 *
 * **Nothing here re-renders per frame.** A `requestAnimationFrame` loop reads
 * the audio clock and writes what it finds *straight to the DOM* — custom
 * properties on the words of the line being spoken, and `scrollTop` through a
 * motion value. React state is written only when the *active line* changes,
 * which is roughly once every few seconds of speech.
 *
 * That distinction is the whole design. There are two clocks on this screen:
 * one that ticks a few times a minute (which line) and one that ticks at the
 * refresh rate (how far into the word). Putting the second one through React
 * would be a re-render of a several-thousand-element list at 120Hz.
 *
 * **The line is swept word by word, not lit all at once.** A cue says "these
 * eleven words occupy four seconds" and nothing finer, so the words' individual
 * timings are estimated — see `segmentWords`. The estimate is good to within a
 * syllable, which is the tolerance at which the eye stops being able to tell.
 *
 * **The scroll is a spring, not `scrollIntoView`.** The browser's smooth scroll
 * is a fixed-duration ease with no interruption model: ask it to scroll again
 * before it has finished and implementations variously queue, restart, or jump.
 * Since a caption advances every few seconds, that was happening constantly.
 * Here the scroll offset is a `MotionValue` driven by the same spring
 * vocabulary as everything else, so a new target mid-flight is picked up with
 * the current position *and velocity* carried into it — the list changes course
 * rather than starting again.
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

/** How many dots the silence indicator fills across a gap. */
const DOTS = 3;

/**
 * The clock the captions run on: smoothed, in ms, and slightly ahead.
 *
 * Both corrections are here rather than in `readPosition` because they are
 * specific to reading along. The scrubber wants the honest position — a bar
 * that reports 80ms further on than the audio is simply wrong — whereas a
 * highlight has to be *drawn* before the sound it belongs to reaches the ear,
 * or it reads as late. See `CAPTION_LEAD_MS`.
 */
function captionClockMs(offsetMs = 0): number {
  return readPosition() * 1000 + CAPTION_LEAD_MS + offsetMs;
}

export function Captions({ episodeId, className }: { episodeId: string; className?: string }) {
  const t = useTranslator();
  /**
   * Four primitives, not the whole snapshot.
   *
   * `usePlayerState` re-emits on every position tick — several times a second
   * while anything plays, as its own doc says — and this component renders one
   * element per cue. On an 824-cue episode that meant re-rendering eight hundred
   * children several times a second to move a highlight that changes every few
   * seconds, and it held the main thread at 85% busy with individual tasks over
   * half a second long. The frame loops were not the cause; measured, all of
   * them together cost 35ms across six seconds. They were being *starved* by
   * this, which is what the juddering scroll actually was.
   *
   * Each selector returns a primitive, so the store's `Object.is` gate turns a
   * tick into no render at all between one spoken line and the next.
   */
  const isCurrent = usePlayerSelector((s) => s.current?.id === episodeId);
  const playing = usePlayerSelector(
    (s) => s.current?.id === episodeId && s.status === 'playing',
  );
  const durationSec = usePlayerSelector((s) => s.durationSec);

  /**
   * The position, but only while paused.
   *
   * The one-shot below has to re-run when the playhead moves with no frame loop
   * running — a seek while paused. Subscribing to `positionSec` outright would
   * reintroduce exactly the per-tick render this is avoiding, so it collapses to
   * a constant during playback and carries a real value only when there is no
   * loop to do the job instead.
   */
  const pausedPositionSec = usePlayerSelector((s) =>
    s.status === 'playing' ? 0 : s.positionSec,
  );
  const { seek } = usePlayerActions();
  const reduced = usePrefersReducedMotion();
  const glide = useTransition('gentle');

  const [activeIndex, setActiveIndex] = useState(-1);

  /**
   * The listener's correction for this episode's ad load — see `caption-sync`.
   *
   * Read into a ref as well as used directly, because the frame loop must see
   * the current value without being torn down and rebuilt every time somebody
   * presses the nudge control. Rebuilding it mid-sweep drops a frame on the one
   * interaction where the whole point is watching the highlight move.
   */
  const offsetMs = useCaptionOffsetMs(episodeId);
  const offsetRef = useRef(offsetMs);
  offsetRef.current = offsetMs;

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

  /** Whether the sweep should run at all: it needs a clock and a live episode. */
  const syncing = timed && isCurrent && segments.length > 0;

  // ------------------------------------------------------ the word clock ---

  /**
   * The words of the line being spoken, where the transcriber timed them.
   *
   * Only ever computed for one segment. Timing every word of a four-thousand
   * segment transcript up front would be a hundred thousand objects allocated
   * to render the dozen that are on screen, and all of it thrown away when the
   * listener switches episode.
   *
   * **Null for a publisher transcript**, which is the common case: a caption
   * file has no place to put per-word timings, so there is nothing to sweep
   * with. The line is then highlighted whole — see `Line`. Sweeping it on
   * guessed timings looks better in a screenshot and is worse to read along
   * with, because the highlight moves at a constant rate through speech that
   * does not.
   */
  const activeWords = useMemo<TimedWord[] | null>(() => {
    if (!syncing || activeIndex < 0) return null;
    const segment = segments[activeIndex];
    return segment ? segmentWords(segment) : null;
  }, [syncing, segments, activeIndex]);

  /**
   * The silence the playhead is about to sit in, if there is one.
   *
   * The gap *after* the active line, which is the one a listener is inside
   * while nothing is being said — the highlight holds the last line spoken (see
   * `activeSegmentIndex`), so "no line is active" is never the signal.
   */
  const liveGap = useMemo(() => {
    if (!syncing) return null;
    return gapBefore(segments, activeIndex + 1);
  }, [syncing, segments, activeIndex]);

  /**
   * What the frame loop writes to, resolved once per line rather than searched
   * for every frame.
   *
   * `last` is the per-word value most recently written. Comparing against it is
   * what keeps the loop honest: of the dozen or so words in a line, exactly one
   * is being spoken at any instant, so this turns a full pass over the line into
   * a single property write. The rest are already showing the right thing.
   */
  const paintRef = useRef<{ words: TimedWord[]; els: HTMLElement[]; last: number[] } | null>(null);
  const gapRef = useRef<{ dots: HTMLElement[]; startMs: number; endMs: number } | null>(null);

  const listRef = useRef<HTMLOListElement>(null);

  /**
   * Push the audio clock into the DOM.
   *
   * Deliberately not `useCallback` over state — it reads only refs, so it never
   * needs rebuilding and can be shared by the playing loop and the paused
   * one-shot without either restarting the other.
   */
  const paint = useCallback((positionMs: number) => {
    const target = paintRef.current;
    if (target) {
      const { words, els, last } = target;
      for (let i = 0; i < words.length; i += 1) {
        const el = els[i];
        const word = words[i];
        if (!el || !word) continue;

        // Rounded *before* the comparison, not just before the write, so a
        // sub-thousandth change genuinely costs nothing rather than costing a
        // style invalidation to produce an identical value. NaN on the first
        // pass, so every word is written once and none is left showing the
        // previous line's state.
        const p = Math.round(wordProgress(word, positionMs) * 1000) / 1000;
        if (p === last[i]) continue;
        last[i] = p;

        // The attribute is only touched when the *state* changes, not on every
        // frame the value does. Re-setting an attribute to the string it
        // already holds still invalidates style for the element, which for the
        // in-flight word means doing it at the refresh rate for no reason.
        const settled = p <= 0 ? 'no' : p >= 1 ? 'yes' : 'now';
        if (el.dataset['sung'] !== settled) el.dataset['sung'] = settled;

        if (settled !== 'now') {
          // Flat colour: no gradient, no clip. This is every word on screen but
          // one, and it is why the sweep is cheap.
          el.style.removeProperty('--caption-p');
          continue;
        }

        /**
         * One property, on one element, per frame — and nothing else.
         *
         * This loop is the whole per-frame cost of the feature, so what is
         * *absent* matters as much as what is here. It writes no transform and
         * no shadow (see the note in `globals.css`: together they cost two
         * thirds of the frame budget), and it rounds to three places so a value
         * that has not meaningfully moved does not invalidate style at all.
         */
        el.style.setProperty('--caption-p', p.toFixed(3));
      }
    }

    const gap = gapRef.current;
    if (gap) {
      const span = gap.endMs - gap.startMs;
      const g = span > 0 ? Math.max(0, Math.min(1, (positionMs - gap.startMs) / span)) : 0;
      for (let i = 0; i < gap.dots.length; i += 1) {
        // Each dot owns its own share of the silence and fills across it, so
        // three dots read as a progress bar rather than as a decoration.
        const lit = Math.max(0, Math.min(1, (g - i / DOTS) * DOTS));
        gap.dots[i]?.style.setProperty('--caption-lit-amount', lit.toFixed(3));
      }
    }
  }, []);

  /**
   * Re-resolve the frame loop's targets whenever the line changes.
   *
   * `useLayoutEffect` rather than `useEffect`: the new line's words exist in the
   * DOM but have never been written to, and a frame rendered between the commit
   * and a passive effect would show the whole line unlit. Painting before the
   * browser gets to draw closes that window.
   */
  useLayoutEffect(() => {
    const list = listRef.current;

    if (!list || !activeWords || activeWords.length === 0) {
      paintRef.current = null;
    } else {
      const els = Array.from(
        list.querySelectorAll<HTMLElement>(`[data-line="${activeIndex}"] [data-word]`),
      );
      paintRef.current = { words: activeWords, els, last: new Array(activeWords.length).fill(NaN) };
    }

    if (!list || !liveGap) {
      gapRef.current = null;
    } else {
      const dots = Array.from(
        list.querySelectorAll<HTMLElement>(`[data-gap="${activeIndex + 1}"] [data-dot]`),
      );
      gapRef.current = { dots, startMs: liveGap.startMs, endMs: liveGap.endMs };
    }

    paint(captionClockMs(offsetRef.current));
  }, [activeIndex, activeWords, liveGap, paint]);

  /**
   * Follow the audio.
   *
   * `lastRef` rather than comparing against `activeIndex` directly, so the
   * effect does not need the state in its dependency list and tear the loop
   * down and rebuild it on every line change.
   */
  const lastRef = useRef(-1);

  useFrameLoop(syncing && playing, () => {
    const positionMs = captionClockMs(offsetRef.current);

    const next = activeSegmentIndex(segments, positionMs);
    if (next !== lastRef.current) {
      lastRef.current = next;
      setActiveIndex(next);
    }

    paint(positionMs);
  });

  /**
   * Paused, the position still moves on a seek.
   *
   * Read once when playback settles rather than leaving the highlight and the
   * sweep wherever the loop last left them — and, equally, rather than running
   * a frame loop against a clock that is not going anywhere.
   */
  useEffect(() => {
    if (!syncing || playing) return;
    const positionMs = captionClockMs(offsetRef.current);
    const next = activeSegmentIndex(segments, positionMs);
    lastRef.current = next;
    setActiveIndex(next);
    paint(positionMs);
    // `offsetMs` is a dependency even though the value is read through the ref:
    // nudging the sync while paused has to move the highlight immediately, and
    // paused is exactly when somebody is most likely to be adjusting it.
  }, [syncing, playing, segments, pausedPositionSec, offsetMs, paint]);

  // ------------------------------------------------------- the scroll ------

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
  /**
   * Where the spring was last sent.
   *
   * Kept so a second measurement that agrees with the first can be *skipped*
   * rather than restarting the animation — see the effect below.
   */
  const targetRef = useRef<number | null>(null);

  const scrollToActive = useCallback(
    (index: number, animated: boolean) => {
      const list = listRef.current;
      if (!list || index < 0) return;

      const line = list.querySelector<HTMLElement>(`[data-line="${index}"]`);
      if (!line) return;

      const target = line.offsetTop + line.offsetHeight / 2 - list.clientHeight * ANCHOR;
      const clamped = Math.max(0, Math.min(target, list.scrollHeight - list.clientHeight));

      if (!animated) {
        targetRef.current = clamped;
        offset.jump(clamped);
        return;
      }

      /**
       * A jump, not a glide, when the playhead has genuinely moved.
       *
       * Gliding is right for the ordinary case — one line to the next, a few
       * hundred pixels — and wrong for a seek, which can be an hour of
       * transcript away. Springing across that flings the column through
       * several thousand lines of somebody else's conversation at a speed
       * nobody can read, for as long as it takes to arrive.
       *
       * The same reasoning as `JUMP_SEC` in the playback clock, one layer up:
       * past a certain size a movement is a discontinuity, and a cut is the
       * honest way to draw one.
       */
      if (Math.abs(clamped - offset.get()) > list.clientHeight * 2) {
        targetRef.current = clamped;
        offset.jump(clamped);
        return;
      }

      /*
        Re-anchored only when the reader has actually taken over.

        This used to re-sync whenever the motion value and `scrollTop`
        disagreed by more than a pixel, which sounds harmless and was the main
        source of stutter: `scrollTop` is quantised by the browser while the
        motion value is not, so mid-glide the two routinely differ by about a
        pixel — and `jump` resets velocity to zero. The spring was being
        stopped dead and restarted several times on the way to every line,
        which is exactly the juddering this scroll is supposed to avoid.

        A hand-scroll is already caught by `yieldToReader`, which jumps the
        value itself, so the only disagreement worth acting on here is a large
        one — a resize, or a layout that moved under us.
      */
      if (Math.abs(offset.get() - list.scrollTop) > 24) offset.jump(list.scrollTop);

      animate(offset, clamped, glide);
      targetRef.current = clamped;
    },
    [offset, glide],
  );

  useEffect(() => {
    if (activeIndex < 0 || !followingRef.current) return;

    scrollToActive(activeIndex, !reduced);

    /**
     * Measured again next frame, and re-aimed only if the answer moved.
     *
     * The second pass exists because the column's own end padding is set from
     * a height measured in an effect, and a web font swapping in reflows every
     * line — so the first measurement after mount can be against a list that
     * has not settled. What it must *not* do is restart a healthy animation
     * every few seconds for the rest of the episode, which is what calling it
     * unconditionally did: the spring lost its velocity one frame in and
     * finished the trip as a slower, flatter second animation.
     *
     * A pixel of tolerance, because sub-pixel layout differences are not a
     * reflow and re-aiming at them costs a visible hitch to move nothing.
     */
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      const line = list?.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`);
      if (!list || !line) return;

      const target = line.offsetTop + line.offsetHeight / 2 - list.clientHeight * ANCHOR;
      const clamped = Math.max(0, Math.min(target, list.scrollHeight - list.clientHeight));

      if (targetRef.current === null || Math.abs(clamped - targetRef.current) > 1) {
        scrollToActive(activeIndex, !reduced);
      }
    });

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
   * Where the silences are, and where the speaker changes.
   *
   * Computed once per transcript rather than per line, because both questions
   * are about a segment's *neighbour* and answering them inside the render of
   * each line would be a pass over the array for every line in it.
   */
  const structure = useMemo(() => {
    return segments.map((segment, index) => ({
      gap: timed ? gapBefore(segments, index) : null,
      // A label on every line would be a column of names down the side of the
      // transcript. It is a change of voice that is worth marking, and only
      // then — which is also how a script is written.
      speaker:
        segment.speaker && segment.speaker !== segments[index - 1]?.speaker
          ? segment.speaker
          : null,
    }));
  }, [segments, timed]);

  /**
   * The lines, rebuilt only when something about them changed.
   *
   * Without this the list is rebuilt on every position report — four times a
   * second, creating one element per segment each time. On a long transcript
   * that is thousands of allocations a second to move one highlight, and it is
   * the kind of cost that never shows up as a single slow frame, just as a
   * screen that never feels quite smooth.
   *
   * `activeWords` is in the dependency list and changes with the line, but only
   * the active `Line` receives it — every other line is handed `null` and its
   * memo holds.
   */
  const lines = useMemo(
    () =>
      segments.map((segment, index) => (
        <Fragment key={segment.index}>
          {structure[index]?.gap ? (
            <Silence index={index} label={t.t('captions.silence')} />
          ) : null}
          <Line
            segment={segment}
            speaker={structure[index]?.speaker ?? null}
            distance={timed ? bucket(segment.index, activeIndex) : null}
            words={index === activeIndex ? activeWords : null}
            onSelect={timed && isCurrent ? () => onSeek(seekTargetSec(segment)) : null}
          />
        </Fragment>
      )),
    [segments, structure, timed, activeIndex, activeWords, isCurrent, onSeek, t],
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
    <div
      className={['flex min-h-0 flex-col', className ?? ''].join(' ')}
      /**
       * The caption size moved up here from the list, and it had to.
       *
       * The measure below is in `ch`, which resolves against the font size of
       * the element it is written on — so the size has to be on an ancestor of
       * everything that uses it, not on the list alone. Setting it here leaves
       * `max-w-[34ch]` on the list resolving against exactly the same inherited
       * size it always did, and lets the sync row underneath line up with the
       * column instead of guessing at its width.
       *
       * Deliberately not a type token. Every size in the scale is for reading at
       * arm's length in a dense screen; this is read at a glance, from further
       * away, as the only text on its half of the window. It is also the one
       * place whose size should follow the window, because the column it lives
       * in does.
       */
      style={{ fontSize: 'clamp(1.375rem, 1.9vw, 1.875rem)' }}
    >
    <ol
      ref={listRef}
      aria-label={t.t('transcript.title')}
      style={{
        // Size is inherited from the wrapper, which is where it has to be set
        // for `34ch` below and the sync row underneath to resolve against the
        // same measure. See the note there.
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
        /**
         * The two ends of the sweep, set once for the whole column.
         *
         * Written here rather than in the stylesheet because they are derived
         * from the theme's text colour, and `color-mix` against a custom
         * property is the only way to get "the same colour, quieter" that
         * survives a theme change. The unsung weight is the number that took
         * the most looking at: much below this the line is unreadable ahead of
         * the voice, which defeats reading along; much above it and the sweep
         * stops being visible at all.
         */
        ['--caption-lit' as string]: 'var(--color-text-primary)',
        ['--caption-dim' as string]:
          'color-mix(in oklab, var(--color-text-primary) 38%, transparent)',
      }}
      className={[
        // `min-h-0 flex-1` rather than `h-full`: the list is now a flex child
        // sharing the column with the sync row, and `h-full` would claim the
        // whole height and push that row out of the panel.
        'm-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain',
        // The measure is the point of the column. A caption running the full
        // width of a wide window is a line of body text in a large font, not a
        // lyric — the eye has to travel too far to find the next one, and the
        // shape stops reading as speech.
        'w-full max-w-[34ch] ps-1 pe-4',
        'scrollbar-none',
      ].join(' ')}
    >
      {lines}
    </ol>

      {/* Only for the episode actually playing, and only when the cues carry
          timings — there is nothing to be out of sync with otherwise. */}
      {syncing ? (
        <CaptionSync
          episodeId={episodeId}
          offsetMs={offsetMs}
          driftMs={driftMs(transcript?.audioDurationMs, durationSec)}
          /* The rule for which transcripts the pipeline is for lives in
             `@cue/core` so the server and the client cannot drift on it. */
          canFix={canAlign(transcript)}
          aligned={transcript?.aligned ?? false}
        />
      ) : null}
    </div>
  );
}

/**
 * "These captions do not match what I am hearing."
 *
 * The control that answers the one caption complaint no amount of care in the
 * timing code can fix: the audio a listener is served is stitched per request,
 * so it is frequently a different cut from the one that was transcribed —
 * different ads, in different places, and a different amount of drift for each
 * person. See `caption-sync` for why this is a manual nudge rather than an
 * automatic rescale.
 *
 * Quiet until it has a reason to speak. With no measured drift and no stored
 * correction this is a single muted word, because the overwhelming majority of
 * transcripts are in sync and a permanent row of adjustment buttons under them
 * is an apology for a problem the reader does not have. When the two durations
 * are known to disagree it says so plainly — that is the case where somebody is
 * otherwise left thinking the feature is simply broken.
 */
function CaptionSync({
  episodeId,
  offsetMs,
  driftMs: drift,
  canFix,
  aligned,
}: {
  episodeId: string;
  offsetMs: number;
  /** Non-null only when the two durations are known *and* disagree. */
  driftMs: number | null;
  /** Whether these cues are the publisher's, and so re-timable. */
  canFix: boolean;
  /** Whether a correction has already been applied to them. */
  aligned: boolean;
}) {
  const t = useTranslator();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  /**
   * Ask the server to find the ads and re-time the cues around them.
   *
   * On success the transcript query is invalidated rather than patched: the
   * corrected cues come back from the same endpoint the panel already reads, so
   * there is one shape of transcript in the app and no second path that has to
   * stay in step with it.
   *
   * A null `outcome` means the work outlived the request. The refetch still runs
   * — it will usually have landed by the time the user looks — and if it has not,
   * the correction appears on their next visit. Nothing here polls, because the
   * only thing a poll would buy is a few seconds on a job the reader has already
   * been told about.
   */
  const fix = useMutation({
    mutationFn: () => api.alignTranscript(episodeId),
    onSuccess: async (result) => {
      const key = queryKeys.episode.transcript(episodeId);
      await queryClient.invalidateQueries({ queryKey: key });

      /**
       * Look once more, later, when the work outlived the request.
       *
       * `outcome: null` means the server was still sampling audio when it
       * answered. The refetch above will have found the cues unchanged, and
       * without this the reader would have pressed a button, watched it settle
       * back, and seen nothing happen — which is how a working feature comes to
       * be described as broken.
       *
       * One retry, not a poll. The correction is written to the row either way,
       * so the worst case this leaves is a reader who sees it on their next
       * visit rather than a client that keeps asking forever.
       */
      if (!result.outcome) {
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: key });
        }, 20_000);
      }

      return result;
    },
  });

  /** The correction is on the cues, so a stored nudge for the old ones is stale. */
  const applyFix = () => {
    setCaptionOffsetMs(episodeId, 0);
    fix.mutate();
  };

  // Opened on its own when there is evidence, so the fix is in front of the
  // person who needs it rather than behind a control they have no reason to
  // press. A stored offset does the same: they have used this before on this
  // episode and are likely to want it again.
  const expanded = open || drift !== null || offsetMs !== 0;

  const nudge = (delta: number) => setCaptionOffsetMs(episodeId, offsetMs + delta);

  if (!expanded) {
    return (
      <div className="w-full max-w-[34ch] ps-1 pe-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="type-caption mt-2 cursor-pointer border-0 bg-transparent p-0 text-[var(--color-text-tertiary)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-text-secondary)] hover:decoration-[var(--color-border-strong)]"
        >
          {t.t('captions.outOfSync')}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[34ch] ps-1 pe-4">
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-2.5">
        {drift !== null ? (
          // Said once, above the controls, and only when it is true. The number
          // is not shown: it is the difference in *total length*, which is the
          // evidence that the files differ rather than the amount any given cue
          // is out by, and printing it would invite someone to dial in exactly
          // that and find it did not work.
          <p className="type-caption m-0 w-full text-[var(--color-text-tertiary)]">
            {t.t('captions.differentCut')}
          </p>
        ) : null}

        {canFix && !aligned ? (
          <button
            type="button"
            onClick={applyFix}
            disabled={fix.isPending}
            className="type-caption w-full cursor-pointer rounded-full border border-[var(--color-border-strong)] bg-transparent px-3 py-1.5 text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-default disabled:opacity-60"
          >
            {fix.isPending ? t.t('captions.fixing') : t.t('captions.fix')}
          </button>
        ) : null}

        {fix.isError ? (
          <p className="type-caption m-0 w-full text-[var(--color-text-tertiary)]">
            {t.t('captions.fixFailed')}
          </p>
        ) : null}

        {aligned ? (
          <p className="type-caption m-0 w-full text-[var(--color-text-tertiary)]">
            {t.t('captions.fixed')}
          </p>
        ) : null}

        <span className="type-caption text-[var(--color-text-secondary)]">
          {t.t('captions.sync')}
        </span>

        <div className="flex items-center gap-1">
          <NudgeButton
            label={t.t('captions.syncEarlier')}
            onClick={() => nudge(-OFFSET_STEP_MS)}
            glyph="−"
          />

          {/*
            The current correction, in seconds and always signed.

            Signed even at zero-point-something, because the sign is the only
            part that says which way the last press moved things — and somebody
            adjusting this is pressing a button and watching the words, not
            reading a number they already predicted.
          */}
          <span className="type-timecode min-w-[3.5em] text-center text-[var(--color-text-primary)]">
            {offsetMs === 0 ? '0.0s' : `${offsetMs > 0 ? '+' : '−'}${(Math.abs(offsetMs) / 1000).toFixed(1)}s`}
          </span>

          <NudgeButton
            label={t.t('captions.syncLater')}
            onClick={() => nudge(OFFSET_STEP_MS)}
            glyph="+"
          />
        </div>

        {offsetMs !== 0 ? (
          <button
            type="button"
            onClick={() => setCaptionOffsetMs(episodeId, 0)}
            className="type-caption cursor-pointer border-0 bg-transparent p-0 text-[var(--color-text-tertiary)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-text-secondary)] hover:decoration-[var(--color-border-strong)]"
          >
            {t.t('captions.syncReset')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NudgeButton({
  label,
  onClick,
  glyph,
}: {
  label: string;
  onClick: () => void;
  glyph: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      // 28px rather than the 44px minimum: this sits inside a reading column at
      // caption size, and a pair of full-size touch targets under the words
      // would out-weigh the transcript they are adjusting. It is a secondary
      // control on a surface that is not primarily touch-driven.
      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--color-border-strong)] bg-transparent type-caption leading-none text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      {glyph}
    </button>
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
 *
 * The active line's opacity is 1 and stays 1: its *words* carry the state now,
 * lit behind the voice and dim ahead of it, and dimming the line as a whole on
 * top of that would mean the unsung half of the current line and the whole of
 * the next one were the same colour.
 */
const DEPTH = {
  0: { opacity: 1, blur: 0, scale: 1 },
  1: { opacity: 0.4, blur: 0.7, scale: 0.965 },
  2: { opacity: 0.26, blur: 1.4, scale: 0.955 },
  3: { opacity: 0.16, blur: 2, scale: 0.95 },
} as const;

const Line = memo(function Line({
  segment,
  speaker,
  distance,
  words,
  onSelect,
}: {
  segment: TranscriptSegment;
  /** Set only where the voice changes, so the column is not a list of names. */
  speaker: string | null;
  /** Null when the transcript carries no timings — every line reads the same. */
  distance: 0 | 1 | 2 | 3 | null;
  /** The per-word timings, on the active line only. Null on every other. */
  words: TimedWord[] | null;
  onSelect: (() => void) | null;
}) {
  const depth = distance === null ? { opacity: 0.85, blur: 0, scale: 1 } : DEPTH[distance];

  const content = (
    <span
      className="block"
      style={{
        opacity: depth.opacity,
        // Grown from the start edge rather than the centre: scaling about the
        // middle makes the text drift sideways as it advances, and the reader's
        // eye is holding the start of the line.
        transform: `scale(${depth.scale})`,
        transformOrigin: 'left center',
        filter: depth.blur ? `blur(${depth.blur}px)` : undefined,
        /**
         * The advance is sprung; the fade is not.
         *
         * `transform` settles on the real spring curve — the same physics the
         * player's own expansion uses, tabulated for CSS — so a line arriving
         * at full size overshoots once and settles, which is what makes it read
         * as a line stepping forward rather than a number being assigned.
         *
         * Opacity and blur stay tweens, because a spring overshoots past 1, the
         * compositor clamps it, and the clamp reads as a flicker at the end of
         * every fade. Springs move things; tweens fade them.
         */
        transition: [
          'opacity var(--duration-slow) var(--ease-standard)',
          'filter var(--duration-slow) var(--ease-standard)',
          'transform var(--spring-standard-duration) var(--spring-standard)',
        ].join(', '),
      }}
    >
      {/*
        Two ways to be the line being spoken.

        With measured word timings the line is split into pieces the frame loop
        sweeps through. Without them — every publisher caption file, since the
        format has nowhere to put per-word timings — the line is simply itself,
        lit as a whole against the dimmed lines around it.

        The second is not a degraded first. A swept line built on guessed
        timings advances at a constant rate through speech that does not, so it
        spends most of a sentence highlighting the wrong word; the eye follows
        it and is misled. A line that says only "this sentence, now" says less
        and is never wrong, which is the trade Apple makes too.
      */}
      {words ? (
        words.map((word, i) => (
          <Fragment key={word.index}>
            {i > 0 ? ' ' : null}
            {/* `data-word` is what the frame loop writes to. The initial
                `data-sung` matters: a word that has never been painted still
                has to render as unsung rather than as unstyled. */}
            <span data-word={word.index} data-sung="no" className="caption-word">
              {word.text}
            </span>
          </Fragment>
        ))
      ) : (
        segment.text
      )}
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
      {speaker ? (
        // Small, quiet, and in the UI size rather than the caption size — it is
        // a label on the speech, not part of it, and setting it in the caption
        // size would make every change of voice louder than the words.
        <span
          className="type-caption mb-[0.35em] block font-semibold tracking-wide text-[var(--color-text-tertiary)] uppercase"
          style={{ opacity: depth.opacity, letterSpacing: '0.06em' }}
        >
          {speaker}
        </span>
      ) : null}

      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          className="caption-line w-full cursor-pointer border-0 bg-transparent p-0 text-start font-[inherit] text-[inherit] leading-[inherit] tracking-[inherit]"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
});

/**
 * A gap in the speech, drawn.
 *
 * Three dots that fill in turn while nothing is being said. The alternative is
 * a screen that simply freezes for thirty seconds of theme music, which is
 * indistinguishable from captions that have crashed — and the moment a listener
 * most needs to be told the sync is alive is the moment it has nothing to say.
 *
 * Rendered for every long gap in the transcript but only *animated* for the one
 * the playhead is inside; the rest sit at rest, which is also how they read
 * when scrolling back through an episode.
 */
const Silence = memo(function Silence({ index, label }: { index: number; label: string }) {
  return (
    <li data-gap={index} className="my-[0.72em] flex items-center gap-[0.34em]">
      <span className="sr-only">{label}</span>
      {Array.from({ length: DOTS }, (_, i) => (
        <span
          key={i}
          data-dot={i}
          aria-hidden="true"
          className="caption-dot block h-[0.34em] w-[0.34em] rounded-full bg-[var(--color-text-primary)]"
        />
      ))}
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
