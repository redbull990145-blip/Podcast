'use client';

import { queryKeys } from '@cue/api-client';
import { activeSegmentIndex, seekTargetSec } from '@cue/core';
import type { TranscriptSegment } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { api } from '@/lib/api';
import { usePrefersReducedMotion } from '@/lib/motion';
import { usePlayerActions, usePlayerState, readPosition } from '@/lib/player/store';
import { GenerateCaptions } from './generate-captions';

/**
 * The captions, following the audio.
 *
 * **Nothing here re-renders per frame.** A `requestAnimationFrame` loop reads
 * the audio clock and asks which line is active, but React state is written
 * only when that answer *changes* — roughly once every few seconds of speech.
 * At 120Hz the difference is two renders a second against two hundred and forty,
 * and it is the single reason this can sit over a blurred backdrop and still
 * scroll at full frame rate.
 *
 * **Distance is bucketed, not exact.** Each line is dimmed and blurred by how
 * far it sits from the active one, but the distance is clamped to four steps.
 * A line's appearance therefore changes at most four times over the whole
 * episode instead of on every advance, so the memoised rows below mostly do not
 * re-render at all — which is what keeps a thousand-line transcript cheap.
 */
export function Captions({ episodeId, className }: { episodeId: string; className?: string }) {
  const t = useTranslator();
  const state = usePlayerState();
  const { seek } = usePlayerActions();
  const reduced = usePrefersReducedMotion();

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

  /**
   * Keep the active line where the eye already is.
   *
   * `block: 'center'` rather than 'start': the line being spoken belongs in the
   * middle of the column with what was just said above it and what is coming
   * below, which is how a person reads along. Scrolling only while playing, so
   * someone who scrolled back to re-read is not yanked forward mid-sentence.
   */
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!playing || activeIndex < 0) return;
    const line = listRef.current?.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`);
    line?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [activeIndex, playing, reduced]);

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
      className={[
        'm-0 h-full list-none overflow-y-auto overscroll-contain',
        // Half a viewport of padding at each end, so the first and last lines
        // can still reach the middle of the column when centred.
        'px-1 py-[45vh]',
        'scrollbar-none',
        className ?? '',
      ].join(' ')}
    >
      {segments.map((segment) => (
        <Line
          key={segment.index}
          segment={segment}
          distance={timed ? bucket(segment.index, activeIndex) : null}
          onSelect={timed && isCurrent ? () => seek(seekTargetSec(segment)) : null}
        />
      ))}
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

/** Opacity and blur per step. The active line is the only fully sharp one. */
const DEPTH = {
  0: { opacity: 1, blur: 0 },
  1: { opacity: 0.45, blur: 1.2 },
  2: { opacity: 0.3, blur: 2.2 },
  3: { opacity: 0.22, blur: 3 },
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
  const depth = distance === null ? { opacity: 0.85, blur: 0 } : DEPTH[distance];

  const content = (
    <span
      className="block transition-[opacity,filter,transform] duration-[var(--duration-slow)] ease-standard"
      style={{
        opacity: depth.opacity,
        // Blur rather than colour alone: it puts the surrounding lines behind
        // the current one in depth, which is what makes the active line read as
        // *near* rather than merely brighter.
        filter: depth.blur ? `blur(${depth.blur}px)` : undefined,
      }}
    >
      {segment.text}
    </span>
  );

  return (
    <li
      data-line={segment.index}
      // Off-screen lines are skipped for layout and paint. A transcript runs to
      // hundreds of lines and only a handful are ever in view.
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 72px' }}
      // Every line is the same colour; opacity and blur alone carry the
      // distance. Dimming with a second colour as well would make the inactive
      // lines muddy rather than simply further away.
      className="type-title2 my-1 font-semibold tracking-tight text-[var(--color-text-primary)]"
    >
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          className="w-full cursor-pointer border-0 bg-transparent p-0 text-start"
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
