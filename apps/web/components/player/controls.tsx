'use client';

import { PLAYBACK_RATES, type PlaybackRate } from '@cue/core';
import * as m from 'motion/react-m';
import { usePrefersReducedMotion, usePressScale, useTransition } from '@/lib/motion';

/**
 * Player controls, drawn rather than borrowed.
 *
 * Icons are authored SVG in one stroke weight — a glyph font or an emoji
 * standing in for a transport control is the clearest tell that an interface
 * was assembled rather than designed.
 *
 * Press feedback here is read from `usePressScale` rather than gated with a
 * `motion-reduce:` class. Motion writes `transform` inline, and an inline
 * style beats a class rule even inside a media query — so the class version
 * looked like it handled the preference and quietly did nothing.
 */

const ICON = {
  play: 'M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z',
  pause: 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z',
} as const;

export function PlayPauseButton({
  playing,
  loading,
  onToggle,
  size = 44,
  tint,
}: {
  playing: boolean;
  loading: boolean;
  onToggle: () => void;
  size?: number;
  tint?: string | undefined;
}) {
  const press = usePressScale(0.92);
  const transition = useTransition('responsive');

  return (
    <m.button
      type="button"
      onClick={onToggle}
      aria-label={playing ? 'Pause' : 'Play'}
      // Press feedback settles on a spring rather than a tween: a transport
      // control is held, and a spring is what makes it feel like an object
      // rather than a state toggle.
      whileTap={{ scale: press }}
      transition={transition}
      className="flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 text-[var(--color-text-on-accent)]"
      style={{ width: size, height: size, backgroundColor: tint ?? 'var(--color-accent)' }}
    >
      {loading ? (
        <LoadingRing />
      ) : (
        <svg width={size * 0.42} height={size * 0.42} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {/* The icon swaps instantly. Crossfading play and pause reads as
              lag on the one control that must feel immediate. */}
          <path d={playing ? ICON.pause : ICON.play} />
        </svg>
      )}
    </m.button>
  );
}

/**
 * Buffering.
 *
 * A rotating arc rather than a spinner-with-a-label: this appears for a second
 * at most, and any text would be read after it had already gone.
 */
function LoadingRing() {
  const reduced = usePrefersReducedMotion();

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <m.circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        /**
         * Rotation is the part that has to go, not the feedback. A closed ring
         * breathing in place says "working" as clearly as an arc going round,
         * and opacity is the one channel the reduced-motion policy keeps
         * precisely so a state like this survives it.
         *
         * Leaving it static instead would read as a rendering fault — a
         * spinner frozen mid-turn is the shape of a bug.
         */
        strokeDasharray={reduced ? undefined : '14 42'}
        animate={reduced ? { opacity: [0.3, 1, 0.3] } : { rotate: 360 }}
        transition={
          reduced
            ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.9, repeat: Infinity, ease: 'linear' }
        }
        style={{ transformOrigin: 'center' }}
      />
    </svg>
  );
}

export function SkipButton({
  direction,
  seconds,
  onClick,
}: {
  direction: 'back' | 'forward';
  seconds: number;
  onClick: () => void;
}) {
  const back = direction === 'back';
  const press = usePressScale(0.9);
  const transition = useTransition('snappy');

  return (
    <m.button
      type="button"
      onClick={onClick}
      aria-label={back ? `Skip back ${seconds} seconds` : `Skip forward ${seconds} seconds`}
      whileTap={{ scale: press }}
      transition={transition}
      className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {back ? (
          <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M12 5V2l5 4-5 4V7a5 5 0 1 0 5 5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      {/* The number lives inside the arrow, so the control says exactly how
          far it jumps without a separate label. */}
      <span
        aria-hidden="true"
        className="absolute type-caption"
        style={{ fontSize: 9, fontWeight: 600, marginTop: 3 }}
      >
        {seconds}
      </span>
    </m.button>
  );
}

/**
 * Playback speed.
 *
 * A cycling button rather than a dropdown: speed is set once and adjusted
 * rarely, and opening a menu to move from 1× to 1.2× is more interaction than
 * the decision deserves.
 */
export function SpeedButton({
  rate,
  onChange,
}: {
  rate: PlaybackRate;
  onChange: (rate: PlaybackRate) => void;
}) {
  function cycle() {
    const index = PLAYBACK_RATES.indexOf(rate);
    onChange(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]!);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Playback speed: ${rate}×. Tap to change.`}
      className="h-11 min-w-11 cursor-pointer rounded-[var(--radius-md)] border-0 bg-transparent px-2 type-caption text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
    >
      {rate}×
    </button>
  );
}
