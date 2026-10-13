'use client';

import { icon } from '@cue/design';
import * as m from 'motion/react-m';
import { useTranslator } from '@/components/i18n/locale-provider';
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
  variant = 'filled',
}: {
  playing: boolean;
  loading: boolean;
  onToggle: () => void;
  size?: number;
  /**
   * `filled` is an accent disc — the one obvious action in a dense bar of text.
   * `bare` is the glyph alone, for the full player, where it sits in open space
   * on a backdrop taken from the artwork. A coloured disc there competes with
   * the cover it was sampled from; the glyph does not.
   * `ink` is the same disc in the maximum-contrast fill rather than the accent,
   * for the desktop player bar. The accent means *this is what is playing*, and
   * in a bar whose entire subject is the thing that is playing it says nothing
   * — while an orange disc next to an orange progress fill puts two saturated
   * shapes on one 84px strip competing to be looked at.
   *
   * There used to be a fourth behaviour: an optional `tint` that overrode both
   * fills with the episode's own colour, on the reasoning that a show with a
   * colour of its own is carrying information rather than just being loud. In
   * practice `deriveTint`'s `fill` is fitted to OKLab L 0.62 with the chroma
   * capped at 0.12 — deliberately muted, because it is designed to sit *behind*
   * things — so the most important control in the product came out a flat
   * mid-grey-blue on a light bar. Muted is right for a wash and wrong for the
   * button you press most. The artwork still colours the backdrop, the progress
   * fill and the page; the transport is ink.
   */
  variant?: 'filled' | 'bare' | 'ink';
}) {
  const t = useTranslator();
  const bare = variant === 'bare';
  const ink = variant === 'ink';
  // A bare glyph has no edge to squash, so it needs to travel further before
  // the press reads at all. A disc reads at 0.92 because its outline moves.
  const press = usePressScale(bare ? 0.86 : 0.92);
  const transition = useTransition('responsive');

  return (
    <m.button
      type="button"
      onClick={onToggle}
      /* Translated, which it was not. This is the most-pressed control in the
         product and its accessible name was a bare English literal in an app
         that ships Arabic and Hindi — so a screen reader in Cairo announced the
         one button that matters in the wrong language. The keys already
         existed; nothing here was ever asked for them. */
      aria-label={playing ? t.t('episode.pause') : t.t('episode.play')}
      // Press feedback settles on a spring rather than a tween: a transport
      // control is held, and a spring is what makes it feel like an object
      // rather than a state toggle.
      whileTap={{ scale: press }}
      transition={transition}
      className={[
        'flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0',
        bare
          ? 'bg-transparent text-[var(--color-text-primary)]'
          : ink
            ? 'bg-[var(--color-ink)] text-[var(--color-text-on-ink)]'
            : 'text-[var(--color-text-on-accent)]',
      ].join(' ')}
      style={{
        width: size,
        height: size,
        // `ink` and `bare` are handled by the classes above; only the accent
        // disc needs a fill written here.
        ...(bare || ink ? {} : { backgroundColor: 'var(--color-accent)' }),
      }}
    >
      {loading ? (
        <LoadingRing />
      ) : (
        <svg
          // The glyph carries the whole control when there is no disc behind
          // it, so it is drawn much larger relative to its hit area.
          width={size * (bare ? 0.78 : 0.42)}
          height={size * (bare ? 0.78 : 0.42)}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
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

/**
 * Skip, not previous/next.
 *
 * Apple Music puts ⏪ ⏯ ⏩ here because a track is the unit and the next one is
 * three minutes away. A podcast episode is forty minutes long and its unit is
 * the digression you want to jump over, so this stays a timed skip with the
 * number drawn inside the arrow — the same choice Apple's own Podcasts app
 * makes, on the same reasoning. Copying the music glyph here would look right
 * and be wrong.
 */
export function SkipButton({
  direction,
  seconds,
  onClick,
  size = 44,
}: {
  direction: 'back' | 'forward';
  /**
   * How far this control actually jumps.
   *
   * The listener's own interval, not the module default. It is drawn inside the
   * arrow and spoken in the accessible name, so a value that disagrees with
   * what the machine does is a control that lies twice — which is exactly what
   * it did while callers passed `SKIP_BACK_SEC` and the machine used
   * `preferences.skipBackSec`.
   */
  seconds: number;
  onClick: () => void;
  /** Hit area. The glyph and its numeral scale with it. */
  size?: number;
}) {
  const t = useTranslator();
  const back = direction === 'back';
  const press = usePressScale(0.86);
  // `responsive` rather than `snappy`: these sit either side of the play
  // button, and a neighbour that settles on different physics is visible even
  // when you cannot say what changed.
  const transition = useTransition('responsive');
  const glyph = size * 0.62;

  return (
    <m.button
      type="button"
      onClick={onClick}
      /* `player.skipBack`/`player.skipForward` take the interval as a parameter,
         so the announced number follows the listener's own setting rather than
         a template baked in English around a constant. */
      aria-label={t.t(back ? 'player.skipBack' : 'player.skipForward', { seconds })}
      whileTap={{ scale: press }}
      transition={transition}
      className="relative flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[var(--color-text-primary)] transition-opacity hover:opacity-100"
      style={{ width: size, height: size, opacity: 0.75 }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={back ? icon.skipBack : icon.skipForward} />
      </svg>
      {/*
        The number lives inside the ring, so the control says exactly how far it
        jumps without a separate label.

        `inset-0` and centred with flex, not a bare `absolute`. An absolutely
        positioned box with no insets falls back to its *static* position, which
        inside a flex row is wherever it would have sat after the icon — so the
        numeral rendered below and to the side of the ring instead of inside it,
        and the control read as a glyph with a stray number attached. Given a
        box the size of the button it centres on the same point the ring does.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ fontSize: glyph * 0.3, fontWeight: 600, lineHeight: 1 }}
      >
        {seconds}
      </span>
    </m.button>
  );
}

/*
 * Playback speed used to live here as a cycling button. It is now a panel of
 * presets plus a slider, in `speed-control.tsx` — see the note there for why
 * cycling had to go.
 */
