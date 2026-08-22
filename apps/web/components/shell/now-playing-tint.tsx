'use client';

import { colorVarStyle, tintedScheme } from '@cue/design';
import { animate, AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState } from 'react';
import { lerpColor } from '@/lib/color-lerp';
import { useNowPlayingTint } from '@/lib/now-playing-tint';
import { usePlayerSelector } from '@/lib/player/store';
import { isLightNow, useThemeChoice } from '@/lib/theme';

/**
 * Paint the whole window in the colour of whatever is playing.
 *
 * The podcast page has repainted *itself* from its show's artwork for a while,
 * and this is the same idea given the run of the app: with the setting on, the
 * episode in the player tints every screen, and switching episodes repaints.
 *
 * **Written onto `<html>` rather than emitted as a stylesheet**, which is the
 * opposite of what `ChromeTint` does one level down, and deliberately so. That
 * component renders on the server, where the theme is not yet known, so it has
 * to emit both palettes and let CSS choose. This one is driven by the player —
 * which is a client-side singleton that does not exist until somebody presses
 * play — so it already knows the theme and can resolve to a single answer.
 * Custom properties set inline on the root element also beat every stylesheet
 * rule without a specificity argument, including `[data-theme='light']`, which
 * is what makes "the app is this colour now" actually hold.
 *
 * **A page's own tint still wins inside that page.** `[data-chrome-tint]`
 * re-declares the same variables on the podcast page and its chrome, and a rule
 * on a descendant beats an inherited value. That is the right precedence: while
 * you are looking at a show, the show you are looking at is the subject; the
 * rest of the app carries the show you are listening to.
 *
 * **The change is a movement, not a jump.** Writing the new palette straight
 * onto the root repainted every surface in the app on a single frame, which at
 * this scale does not read as a transition at all — it reads as the window
 * being replaced. Twenty-two variables now interpolate across `TINT_MS` (see
 * `lerpColor` for why in JS rather than in CSS), with a gradient bloom in the
 * incoming colour crossing the screen while they do, so the eye has something
 * to follow from the old palette to the new one.
 */

/**
 * How long a repaint takes, in ms.
 *
 * Long enough to be a transition rather than a flicker, short enough that
 * pressing play and getting a *different* answer than the one you asked for is
 * not something you sit through. Two seconds is also comfortably longer than
 * the bloom below, which has to finish while the palette is still moving or it
 * lifts to reveal a change that has not happened yet.
 */
const TINT_MS = 2000;

export function NowPlayingTint() {
  const enabled = useNowPlayingTint();
  // Selected, not whole-state: this component renders nothing and cares about
  // one string, while the store re-emits on every position tick. Subscribing
  // to the snapshot would re-run this component four times a second during
  // playback to arrive at the same `null`.
  const color = usePlayerSelector((s) => s.current?.accentColor ?? null);
  const isLight = isLightNow(useThemeChoice());
  const reduced = useReducedMotion();

  /**
   * The palette currently written to the root, so the next change knows where
   * it is starting from.
   *
   * A ref rather than state: it is read by an animation frame callback and
   * never drives a render, and making it state would re-run this component
   * sixty times a second to produce the same `null` return.
   */
  const paintedRef = useRef<Record<string, string> | null>(null);

  /** The colour the bloom should be, while one is running. */
  const [bloom, setBloom] = useState<{ id: number; color: string } | null>(null);
  const bloomId = useRef(0);

  useEffect(() => {
    const root = document.documentElement;

    // Resolved to one palette here, because unlike the server-rendered tints
    // this knows which theme is on — see the note above.
    const scheme = enabled && color ? tintedScheme(color, isLight ? 'light' : 'dark') : null;
    const previous = paintedRef.current;

    const write = (vars: Record<string, string>) => {
      for (const [property, value] of Object.entries(vars)) {
        root.style.setProperty(property, value);
      }
    };

    const clear = (vars: Record<string, string>) => {
      for (const property of Object.keys(vars)) {
        root.style.removeProperty(property);
      }
    };

    /*
      Turned off, or nothing playing: give the app its own palette back.

      Cleared rather than animated. There is no destination to move toward —
      the target is whatever the stylesheet says, which is not a value this
      component knows, and interpolating toward a colour we would have to read
      back out of the computed style to discover is a great deal of machinery
      for the one transition nobody is looking at.
    */
    if (!scheme) {
      if (previous) {
        clear(previous);
        paintedRef.current = null;
      }
      return;
    }

    const next = colorVarStyle(scheme);

    /*
      The first paint, and every paint under reduced motion, lands whole.

      There is nothing to animate *from* on the first one — the previous
      palette is the theme's, which is not in hand — and a two-second colour
      wash across the entire window is exactly the kind of large-area movement
      the reduced-motion setting exists to decline.
    */
    if (!previous || reduced) {
      write(next);
      paintedRef.current = next;
      return;
    }

    const from = previous;
    const keys = Object.keys(next);

    // Fired alongside the interpolation rather than after it: the bloom is
    // what carries the eye across the change, so it has to be moving while the
    // change is happening.
    const id = (bloomId.current += 1);
    setBloom({ id, color: scheme.accent });

    const controls = animate(0, 1, {
      duration: TINT_MS / 1000,
      // Eased rather than sprung. A spring overshoots, and overshooting a
      // colour means passing *through* the destination and coming back — on a
      // full-window fill that is a visible flash of a palette belonging to
      // nothing.
      ease: [0.22, 0.61, 0.36, 1],
      onUpdate: (t) => {
        for (const key of keys) {
          const start = from[key];
          const end = next[key]!;
          root.style.setProperty(key, start ? lerpColor(start, end, t) : end);
        }
      },
      onComplete: () => {
        // Written exactly rather than left on the last interpolated frame,
        // which is 0.999 of the way there and would leave every colour in the
        // app a rounding error away from the palette it claims to be.
        write(next);
      },
    });

    paintedRef.current = next;

    return () => controls.stop();
  }, [enabled, color, isLight, reduced]);

  /*
    Cleanup on unmount only.

    Deliberately a separate effect with an empty dependency list. Folding this
    into the one above would tear the palette off the root on every change of
    episode — a frame of the untinted theme between two tints, which is the
    flash the whole component exists to remove.
  */
  useEffect(() => {
    const root = document.documentElement;
    return () => {
      const painted = paintedRef.current;
      if (!painted) return;
      for (const property of Object.keys(painted)) root.style.removeProperty(property);
    };
  }, []);

  return (
    <AnimatePresence>
      {bloom ? (
        <TintBloom
          key={bloom.id}
          color={bloom.color}
          onDone={() => setBloom((current) => (current?.id === bloom.id ? null : current))}
        />
      ) : null}
    </AnimatePresence>
  );
}

/**
 * The wash that crosses the screen while the palette moves under it.
 *
 * A radial gradient rather than a flat fill, anchored low and off to one side
 * where the player bar is — so it reads as the colour arriving *from* the thing
 * that just started playing, rather than as an overlay switched on over the
 * whole page. It scales up as it fades, which is what keeps it feeling like
 * light spreading instead of a panel appearing.
 *
 * `pointer-events-none` and `aria-hidden` throughout: this is atmosphere, and
 * it sits above the entire app for two seconds. Anything less would mean a
 * click landing on nothing every time an episode changes.
 */
function TintBloom({ color, onDone }: { color: string; onDone: () => void }) {
  return (
    <m.div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[60]"
      initial={{ opacity: 0, scale: 1.15 }}
      /*
        Up and back down in one keyframed run, so the whole gesture is a single
        animation with one completion rather than an enter that has to be told
        when to leave. The peak sits at 0.22 — present enough to read as a
        sweep of colour, far from enough to obscure what anybody is reading.
      */
      animate={{ opacity: [0, 0.22, 0.16, 0], scale: [1.15, 1, 1, 1] }}
      exit={{ opacity: 0 }}
      transition={{
        duration: TINT_MS / 1000,
        times: [0, 0.28, 0.6, 1],
        ease: 'easeInOut',
        opacity: { duration: TINT_MS / 1000, times: [0, 0.28, 0.6, 1] },
      }}
      onAnimationComplete={onDone}
      style={{
        background: `radial-gradient(120% 80% at 50% 100%, ${color}, transparent 70%)`,
        // Lightens rather than covers, so text underneath keeps its contrast
        // instead of being veiled for two seconds.
        mixBlendMode: 'soft-light',
      }}
    />
  );
}
