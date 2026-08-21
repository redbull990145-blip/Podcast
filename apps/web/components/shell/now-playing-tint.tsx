'use client';

import { colorVarStyle, tintedScheme } from '@cue/design';
import { useEffect } from 'react';
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
 * Renders nothing. It is an effect with a component around it so that it can
 * live in the shell and read player state.
 */
export function NowPlayingTint() {
  const enabled = useNowPlayingTint();
  // Selected, not whole-state: this component renders nothing and cares about
  // one string, while the store re-emits on every position tick. Subscribing
  // to the snapshot would re-run this component four times a second during
  // playback to arrive at the same `null`.
  const color = usePlayerSelector((s) => s.current?.accentColor ?? null);
  const isLight = isLightNow(useThemeChoice());

  useEffect(() => {
    const root = document.documentElement;

    // Resolved to one palette here, because unlike the server-rendered tints
    // this knows which theme is on — see the note above.
    const scheme = enabled && color ? tintedScheme(color, isLight ? 'light' : 'dark') : null;

    if (!scheme) return;

    const vars = colorVarStyle(scheme);
    for (const [property, value] of Object.entries(vars)) {
      root.style.setProperty(property, value);
    }

    /*
      Removed on the way out, not overwritten on the way in.

      The cleanup has to run on every change of episode as well as on unmount,
      or a show whose palette happens to omit a variable the previous one set
      would inherit that one value from the episode before it — a slow drift
      into a palette belonging to nothing that is playing. Clearing first and
      writing fresh is the only version that cannot accumulate.
    */
    return () => {
      for (const property of Object.keys(vars)) {
        root.style.removeProperty(property);
      }
    };
  }, [enabled, color, isLight]);

  return null;
}
