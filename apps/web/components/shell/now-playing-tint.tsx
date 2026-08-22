'use client';

import { colorVarStyle, tintedScheme } from '@cue/design';
import { animate, AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState } from 'react';
import { buildRamp, rampAt } from '@/lib/color-lerp';
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
 * `buildRamp` for why the colours are parsed once rather than every frame, and
 * `PALETTE_STEP_MS` below for why the writes themselves are throttled), with a
 * gradient bloom in the incoming colour crossing the screen while they do, so
 * the eye has something to follow from the old palette to the new one.
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

/**
 * How often the *palette* is allowed to move, in ms.
 *
 * The bloom below runs at the display's refresh rate, because it is opacity and
 * transform on two composited layers and costs the main thread nothing. The
 * palette cannot: every write puts twenty-two inherited custom properties on
 * `<html>`, and the browser answers by recalculating style for every element in
 * the document and repainting everything that reads one — measured on this
 * app's own document at 17–20ms per write-cycle, which is already past a
 * 16.7ms frame budget *by itself*, before anything else that frame has to do.
 * Writing every `requestAnimationFrame` tick, as this once did, was not
 * "smooth but a bit heavy" — it was structurally incapable of holding 60fps
 * for the length of the transition, on every single frame of it.
 *
 * 90ms is not a small tweak on that number, deliberately. Colour is the one
 * property here that tolerates it: a two-second fade stepped eleven times
 * over is eleven stops between two neighbouring hues, and the eye reads that
 * as a continuous ramp the same way film reads 24 discrete frames a second as
 * motion. What a slower step buys is headroom — most frames now do no palette
 * work at all, so the compositor-only bloom actually gets the frame budget
 * this file spends its second half asking for.
 */
const PALETTE_STEP_MS = 90;

export function NowPlayingTint() {
  const enabled = useNowPlayingTint();
  /*
    Two selectors, not the whole snapshot: this component renders almost
    nothing and the store re-emits on every position tick.

    The episode id is here as well as the colour because they answer different
    questions. The colour decides what to *paint*; the id decides whether
    anything happened. Keyed on colour alone, moving between two episodes of
    the same show was a no-op — same accent, same palette, no effect re-run,
    no sweep — so the app acknowledged a change of podcast and ignored a change
    of episode, which from the listener's side is the more common of the two.
  */
  const episodeId = usePlayerSelector((s) => s.current?.id ?? null);
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

  /**
   * Which episode the last sweep was for.
   *
   * The effect below re-runs for the theme as well as for the episode, and a
   * theme toggle must not fire one: the palette genuinely does change — every
   * variable moves from the dark fit to the light one — but nothing *started
   * playing*, and a two-second wash of the accent colour across the window is
   * an announcement about the player. Comparing against this is what keeps the
   * sweep meaning one thing.
   */
  const sweptFor = useRef<string | null>(null);

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
      /*
        Counted as swept even though nothing swept.

        Without this the *next* run of this effect — a theme toggle, most
        likely — would find `sweptFor` still empty, decide this episode had
        never been announced, and fire the sweep it deliberately skipped here.
        Recording it says the announcement for this episode is settled, whether
        it was made or declined.
      */
      sweptFor.current = episodeId;
      return;
    }

    /*
      Everything that has to move, parsed once, with the unchanged variables
      separated out — see `buildRamp`. Two episodes of the same show produce
      identical schemes, so `ramps` is empty and the whole palette is "fixed":
      nothing to interpolate, and the sweep below still runs.
    */
    const { ramps, fixed } = buildRamp(previous, next);
    write(fixed);
    paintedRef.current = next;

    /*
      Fired alongside the interpolation rather than after it: the bloom is what
      carries the eye across the change, so it has to be moving while the change
      is happening. It runs for a change of episode as much as a change of show
      — the colour may be identical, but something did happen — and not at all
      for a change of theme, which re-runs this effect and is not an event about
      the player.
    */
    if (episodeId !== null && episodeId !== sweptFor.current) {
      sweptFor.current = episodeId;
      const id = (bloomId.current += 1);
      setBloom({ id, color: scheme.accent });
    }

    if (ramps.length === 0) return;

    /*
      Throttled to `PALETTE_STEP_MS`, and always allowed to land.

      `t === 1` bypasses the throttle so the final frame is written exactly
      rather than left wherever the last permitted step fell — otherwise every
      colour in the app finishes a rounding error away from the palette it
      claims to be, and the next transition starts from that drift.
    */
    let lastWriteMs = -Infinity;

    const controls = animate(0, 1, {
      duration: TINT_MS / 1000,
      // Eased rather than sprung. A spring overshoots, and overshooting a
      // colour means passing *through* the destination and coming back — on a
      // full-window fill that is a visible flash of a palette belonging to
      // nothing.
      ease: [0.22, 0.61, 0.36, 1],
      onUpdate: (t) => {
        const now = performance.now();
        if (t < 1 && now - lastWriteMs < PALETTE_STEP_MS) return;
        lastWriteMs = now;

        for (const ramp of ramps) {
          root.style.setProperty(ramp.property, rampAt(ramp, t));
        }
      },
      onComplete: () => {
        for (const ramp of ramps) {
          root.style.setProperty(ramp.property, next[ramp.property]!);
        }
      },
    });

    return () => controls.stop();
  }, [enabled, episodeId, color, isLight, reduced]);

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
    <>
      {/*
        The bloom proper: colour rising from the player and filling the window.

        This was a single `soft-light` layer peaking at 0.22, and it was too
        polite to notice — soft-light against an already-dark ground barely
        moves a pixel, so the two seconds of palette interpolation happened
        under an effect nobody could see. `screen` genuinely adds light, and
        the peak is nearly triple, which is what makes the repaint read as an
        event rather than as a colour that was somehow always there.
      */}
      <m.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[60]"
        initial={{ opacity: 0, scale: 1.35 }}
        animate={{ opacity: [0, 0.62, 0.4, 0], scale: [1.35, 1, 1, 1.04] }}
        exit={{ opacity: 0 }}
        transition={{
          duration: TINT_MS / 1000,
          times: [0, 0.22, 0.55, 1],
          ease: 'easeInOut',
        }}
        onAnimationComplete={onDone}
        style={{
          background: `radial-gradient(130% 95% at 50% 100%, ${color}, transparent 72%)`,
          mixBlendMode: 'screen',
          /*
            Promoted to its own layer for the length of the sweep.

            A full-viewport radial gradient is expensive to rasterise, and
            without this hint the browser re-rasterises it on every frame that
            `scale` changes — on the same main thread that is restyling the
            document for the palette underneath. Declared once, it is painted
            once and the transform is handled by the compositor.

            `will-change` is a promise to the browser that costs memory while it
            stands, so it belongs on an element that exists only while animating
            — which this one does: `AnimatePresence` unmounts it when the sweep
            ends, and the layer goes with it.
          */
          willChange: 'transform, opacity',
        }}
      />

      {/*
        A second, faster pass across the top.

        One gradient rising from one edge reads as a glow; two moving against
        each other read as light travelling through the room. This one is
        smaller, brighter and gone in half the time, so it registers as the
        leading edge of the change rather than as a second wash competing with
        the first.
      */}
      <m.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[60]"
        initial={{ opacity: 0, y: '-18%' }}
        animate={{ opacity: [0, 0.34, 0], y: ['-18%', '0%', '10%'] }}
        exit={{ opacity: 0 }}
        transition={{
          duration: TINT_MS / 1000,
          times: [0, 0.3, 0.72],
          ease: 'easeOut',
        }}
        style={{
          background: `radial-gradient(90% 55% at 22% 0%, ${color}, transparent 68%)`,
          mixBlendMode: 'screen',
          willChange: 'transform, opacity',
        }}
      />
    </>
  );
}
