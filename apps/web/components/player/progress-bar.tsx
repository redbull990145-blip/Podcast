'use client';

import { formatTimestamp } from '@cue/core';
import { motion, useMotionValue } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { readPosition, usePlayerActions } from '@/lib/player/store';

/**
 * The scrubber.
 *
 * The rule this component exists to honour: **playback position never becomes
 * React state.** The engine reports roughly four times a second; at 120Hz that
 * would still be four re-renders a second of whatever subtree holds it, for a
 * value whose only job is to move a bar.
 *
 * Instead a `requestAnimationFrame` loop reads the position straight from the
 * audio element and writes a `MotionValue`, which drives a compositor-only
 * `scaleX`. Nothing re-renders while audio plays. The elapsed-time label is the
 * one exception, and it is throttled to once a second because that is the only
 * rate at which it can visibly change.
 */
export function ProgressBar({
  durationSec,
  isPlaying,
  tint,
  compact = false,
}: {
  durationSec: number | null;
  isPlaying: boolean;
  tint?: string | undefined;
  compact?: boolean;
}) {
  const { seek } = usePlayerActions();
  const trackRef = useRef<HTMLDivElement>(null);

  const progress = useMotionValue(0);
  const [elapsed, setElapsed] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  /**
   * Drive the bar from the audio clock, not from React.
   *
   * rAF pauses automatically in a background tab, so a hidden page costs
   * nothing — and it matches the display's refresh rate rather than fighting a
   * fixed interval against it.
   */
  useEffect(() => {
    if (!isPlaying || durationSec === null || durationSec <= 0) return;

    let frame = 0;
    let lastLabel = 0;

    const tick = (timestamp: number) => {
      const position = readPosition();
      progress.set(Math.min(1, position / durationSec));

      // The label can only change once a second; updating it faster is
      // re-rendering to produce identical pixels.
      if (timestamp - lastLabel >= 1000) {
        lastLabel = timestamp;
        setElapsed(position);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, durationSec, progress]);

  // When paused, the bar still has to reflect seeks.
  useEffect(() => {
    if (isPlaying || durationSec === null || durationSec <= 0) return;
    const position = readPosition();
    progress.set(Math.min(1, position / durationSec));
    setElapsed(position);
  }, [isPlaying, durationSec, progress]);

  function positionFromPointer(clientX: number): number | null {
    const track = trackRef.current;
    if (!track || durationSec === null) return null;

    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * durationSec;
  }

  const seekable = durationSec !== null && durationSec > 0;

  return (
    <div className={compact ? '' : 'w-full'}>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={durationSec ?? 0}
        aria-valuenow={Math.round(scrubbing ?? elapsed)}
        aria-valuetext={formatTimestamp(scrubbing ?? elapsed)}
        tabIndex={seekable ? 0 : -1}
        aria-disabled={!seekable}
        onKeyDown={(event) => {
          if (!seekable) return;
          // Keyboard seeking in the same increments as the skip controls, so
          // the two agree about what "a step" means.
          if (event.key === 'ArrowRight') seek(readPosition() + 30);
          if (event.key === 'ArrowLeft') seek(readPosition() - 15);
        }}
        onPointerDown={(event) => {
          if (!seekable) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const next = positionFromPointer(event.clientX);
          if (next !== null) setScrubbing(next);
        }}
        onPointerMove={(event) => {
          if (scrubbing === null) return;
          const next = positionFromPointer(event.clientX);
          if (next !== null) setScrubbing(next);
        }}
        onPointerUp={() => {
          if (scrubbing !== null) {
            seek(scrubbing);
            setScrubbing(null);
          }
        }}
        className={[
          'group relative w-full cursor-pointer touch-none',
          // A 3px bar with a 16px hit area: thin enough to be chrome, tall
          // enough to grab. Making the visible bar itself 16px would be a
          // ribbon across the player.
          compact ? 'py-1' : 'py-2',
          seekable ? '' : 'cursor-default opacity-60',
        ].join(' ')}
      >
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-border-strong)]">
          <motion.div
            className="h-full w-full origin-left rounded-full"
            style={{
              scaleX: scrubbing !== null && durationSec ? scrubbing / durationSec : progress,
              backgroundColor: tint ?? 'var(--color-accent)',
            }}
          />
        </div>
      </div>

      {!compact ? (
        <div className="mt-1 flex justify-between type-caption text-[var(--color-text-tertiary)]">
          <span>{formatTimestamp(scrubbing ?? elapsed)}</span>
          <span>
            {durationSec !== null
              ? `−${formatTimestamp(Math.max(0, durationSec - (scrubbing ?? elapsed)))}`
              : '—'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
