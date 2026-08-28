'use client';

import { formatTimestamp } from '@cue/core';
import { useMotionValue } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState } from 'react';
import { useFrameLoop } from '@/lib/player/frame-clock';
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
  compact = false,
  inline = false,
}: {
  durationSec: number | null;
  isPlaying: boolean;
  compact?: boolean;
  /**
   * Timecodes either side of the track rather than under it.
   *
   * For the desktop player bar, which is 84px tall and has to fit a transport
   * row above this. Stacked, the labels alone are a third of the bar's height;
   * beside the track they cost nothing, because the track was never going to
   * use the full width anyway.
   *
   * Same component rather than a second scrubber: the rAF loop, the pointer
   * capture and the keyboard seeking are the substance here, and the only thing
   * that actually differs between the two players is where two spans sit.
   */
  inline?: boolean;
}) {
  const { seek } = usePlayerActions();
  const trackRef = useRef<HTMLDivElement>(null);

  const progress = useMotionValue(0);
  const [elapsed, setElapsed] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  /**
   * Drive the bar from the audio clock, not from React.
   *
   * The frame loop is shared with everything else that follows the playhead
   * rather than owned here — see `useFrameLoop`. It pauses automatically in a
   * background tab, so a hidden page costs nothing, and it matches the
   * display's refresh rate rather than fighting a fixed interval against it.
   */
  const lastLabelRef = useRef(0);

  useFrameLoop(isPlaying && durationSec !== null && durationSec > 0, (timestamp) => {
    if (durationSec === null || durationSec <= 0) return;

    const position = readPosition();
    progress.set(Math.min(1, position / durationSec));

    // The label can only change once a second; updating it faster is
    // re-rendering to produce identical pixels.
    if (timestamp - lastLabelRef.current >= 1000) {
      lastLabelRef.current = timestamp;
      setElapsed(position);
    }
  });

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

  const elapsedLabel = formatTimestamp(scrubbing ?? elapsed);
  const remainingLabel =
    durationSec !== null
      ? `−${formatTimestamp(Math.max(0, durationSec - (scrubbing ?? elapsed)))}`
      : '—';

  return (
    <div className={compact ? '' : inline ? 'flex w-full items-center gap-3' : 'w-full'}>
      {inline ? (
        <span className="type-timecode w-11 shrink-0 text-end text-[var(--color-text-tertiary)]">
          {elapsedLabel}
        </span>
      ) : null}

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
          'group relative w-full min-w-0 cursor-pointer touch-none',
          // A thin bar with a tall hit area: thin enough to be chrome, tall
          // enough to grab. Making the visible bar itself 16px would be a
          // ribbon across the player.
          compact ? 'py-1' : inline ? 'py-2' : 'py-2.5',
          seekable ? '' : 'cursor-default opacity-60',
        ].join(' ')}
      >
        {/*
          Thickens under the pointer, exactly as the volume bar does — same
          gesture, same affordance, so they should answer the same way. Done
          with `scaleY` rather than a height change: the box stays the height it
          is and only its rendered thickness moves, which keeps the whole thing
          on the compositor and stops the control row relaying out on hover.
        */}
        <div
          className={[
            'w-full origin-center overflow-hidden rounded-full bg-[var(--color-border-strong)]',
            compact ? 'h-[3px]' : inline ? 'h-1' : 'h-1.5',
            'transition-transform duration-[var(--duration-fast)] ease-standard',
            compact
              ? ''
              : scrubbing !== null
                ? 'scale-y-100'
                : 'scale-y-[0.55] group-hover:scale-y-100 group-focus-visible:scale-y-100',
          ].join(' ')}
        >
          {/*
            No transition on the fill, deliberately.

            This one is already written every animation frame from the audio
            clock, so it is as smooth as the display allows. A CSS transition on
            top would restart a 160ms tween sixty times a second and the bar
            would trail the audio it is supposed to be reporting — the one place
            where adding easing makes something less smooth, not more.
          */}
          <m.div
            className="h-full w-full origin-left rounded-full bg-[var(--color-text-primary)]"
            style={{
              scaleX: scrubbing !== null && durationSec ? scrubbing / durationSec : progress,
            }}
          />
        </div>
      </div>

      {inline ? (
        <span className="type-timecode w-11 shrink-0 text-[var(--color-text-tertiary)]">
          {remainingLabel}
        </span>
      ) : null}

      {!compact && !inline ? (
        <div className="mt-1 flex justify-between type-timecode text-[var(--color-text-tertiary)]">
          <span>{elapsedLabel}</span>
          <span>{remainingLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
