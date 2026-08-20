'use client';

import { icon } from '@cue/design';
import * as m from 'motion/react-m';
import { useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { usePressScale, useTransition } from '@/lib/motion';

/**
 * Volume.
 *
 * The machine has had a clamped, tested `setVolume` since the audio engine
 * landed and nothing has ever called it — the only way to change the level was
 * the operating system's own mixer, which sets it for every tab at once.
 *
 * Unlike the scrubber, this is ordinary React state. Volume changes when a
 * hand moves, not sixty times a second on its own, so there is nothing here to
 * keep out of the render path: the rule the scrubber follows exists because
 * playback position updates forever, and this does not.
 *
 * The bar is thin at rest and thickens under the pointer. That is the whole
 * hover treatment — a volume control is not something you are looking for, so
 * it stays quiet until you are near it, and then it is obviously grabbable.
 */
export function VolumeSlider({ volume, onChange }: { volume: number; onChange: (v: number) => void }) {
  const t = useTranslator();
  const trackRef = useRef<HTMLDivElement>(null);

  /*
    Two copies of "is a finger down", and both are needed.

    The ref is the one the move handler reads. React state is applied on the
    next render, but pointer events keep arriving before that render happens —
    so a handler closed over `dragging` still saw `false` for the first several
    moves of every drag. The slider therefore jumped to wherever you pressed
    and then ignored you until you let go and pressed again, which is exactly
    the "doesn't work properly" people report. A ref updates synchronously, so
    the very next move is already live.

    The state exists only because the bar thickens while you hold it, and
    thickening is a render.
  */
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  /**
   * The level to come back to when unmuting.
   *
   * A ref rather than state: nothing renders from it, and it must survive the
   * render that setting the volume to zero causes. Seeded at a half-sensible
   * default so unmuting from a session that *started* silent still does
   * something rather than appearing broken.
   */
  const beforeMute = useRef(0.7);
  const muted = volume === 0;

  function levelFromPointer(clientX: number): number | null {
    const track = trackRef.current;
    if (!track) return null;

    const rect = track.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    // Right-to-left locales mirror the whole layout, so the geometry has to be
    // read the same way round the text is.
    const forward = getComputedStyle(track).direction === 'rtl' ? 1 - ratio : ratio;
    return Math.max(0, Math.min(1, forward));
  }

  function toggleMute() {
    if (muted) {
      onChange(beforeMute.current);
      return;
    }
    beforeMute.current = volume;
    onChange(0);
  }

  return (
    <div className="flex w-full items-center gap-2.5">
      <SpeakerButton
        muted={muted}
        onClick={toggleMute}
        label={muted ? t.t('player.unmute') : t.t('player.mute')}
      />

      <div
        ref={trackRef}
        role="slider"
        aria-label={t.t('player.volume')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
        aria-valuetext={`${Math.round(volume * 100)}%`}
        tabIndex={0}
        onKeyDown={(event) => {
          // 5% steps: fine enough to land where you meant, coarse enough that
          // crossing the range does not need twenty presses.
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault();
            onChange(Math.min(1, volume + 0.05));
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault();
            onChange(Math.max(0, volume - 0.05));
          }
        }}
        onPointerDown={(event) => {
          // Capture, so a drag that leaves the 6px track — which every drag
          // does — keeps delivering moves here instead of to whatever is
          // underneath.
          event.currentTarget.setPointerCapture(event.pointerId);
          draggingRef.current = true;
          setDragging(true);
          const next = levelFromPointer(event.clientX);
          if (next !== null) onChange(next);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          const next = levelFromPointer(event.clientX);
          if (next !== null) onChange(next);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
          setDragging(false);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragging(false);
        }}
        // Focus is left to the global `:focus-visible` outline rather than
        // given a ring of its own, so this control gets the same one as every
        // other focusable thing in the app.
        className="group relative flex-1 cursor-pointer touch-none py-2.5"
      >
        {/*
          `scaleY` rather than a height change: the bar grows under the pointer,
          and growing it by animating `height` would relayout the control row on
          every hover. The 6px box is always 6px; only its rendered thickness
          moves, entirely on the compositor.
        */}
        <div
          className={[
            'h-1.5 w-full origin-center overflow-hidden rounded-full bg-[var(--color-border-strong)]',
            'transition-transform duration-[var(--duration-fast)] ease-standard',
            dragging ? 'scale-y-100' : 'scale-y-[0.55] group-hover:scale-y-100',
            'group-focus-visible:scale-y-100',
          ].join(' ')}
        >
          <div
            className={[
              'h-full w-full origin-left rounded-full bg-[var(--color-text-primary)]',
              // Eased when the level is set in steps — a keyboard press, or a
              // click partway along the track — and instant while a finger is
              // on it, where a transition is just lag between the pointer and
              // the fill.
              dragging ? '' : 'transition-transform duration-[var(--duration-fast)] ease-standard',
            ].join(' ')}
            // Transform, not width — same reason as above, and it means the
            // fill tracks a dragging finger without touching layout.
            style={{ transform: `scaleX(${volume})` }}
          />
        </div>
      </div>

      <span aria-hidden="true" className="text-[var(--color-text-tertiary)]">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={icon.volumeHigh} />
        </svg>
      </span>
    </div>
  );
}

function SpeakerButton({
  muted,
  onClick,
  label,
}: {
  muted: boolean;
  onClick: () => void;
  label: string;
}) {
  const press = usePressScale(0.86);
  const transition = useTransition('responsive');

  return (
    <m.button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={muted}
      whileTap={{ scale: press }}
      transition={transition}
      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={muted ? icon.volumeMuted : icon.volumeLow} />
      </svg>
    </m.button>
  );
}
