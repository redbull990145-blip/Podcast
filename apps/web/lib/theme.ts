'use client';

import { useSyncExternalStore } from 'react';

/**
 * Which theme is on, and how that gets decided.
 *
 * The theme used to be one boolean living inside the toggle button, which was
 * fine while there were two of them. There are now three schemes and two
 * controls in different parts of the app that can change it, so the state has
 * to exist somewhere neither of them owns.
 *
 * **The document is the source of truth, not this module.** `data-theme` on
 * `<html>` is set by a blocking script in `app/layout.tsx` before the first
 * paint, and everything else — the CSS, the toggle's icon, the picker's
 * selection — reads it from there. A module-level variable would be a second
 * copy that starts out wrong on every server render.
 */

/**
 * The key the inline script in `app/layout.tsx` reads. That script cannot
 * import anything, so this constant and its copy over there have to be kept
 * in step by hand; the comment beside it says so.
 */
export const THEME_KEY = 'cue-theme';

/**
 * Which dark theme the listener prefers, remembered separately.
 *
 * The quick toggle in the masthead flips between light and dark, and "dark" is
 * now two different designs. Without this, choosing Onyx in Settings and then
 * pressing the toggle twice would silently put someone back on the warm theme
 * they had just rejected — the control would be quietly editing a preference
 * it does not present.
 */
const DARK_VARIANT_KEY = 'cue-dark-variant';

/** The dark schemes. `dark` is warm paper; `onyx` is neutral near-black. */
export type DarkVariant = 'dark' | 'onyx';

/**
 * What a listener can pick.
 *
 * `system` is a real choice and the default, not the absence of one: a fresh
 * install follows the OS, which the `prefers-color-scheme` block in tokens.css
 * handles on its own with no attribute written at all.
 */
export type ThemeChoice = 'system' | 'light' | DarkVariant;

const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark', 'onyx'];

/**
 * Broadcast on every change, because two controls can make one.
 *
 * `storage` events only fire in *other* tabs, so they are no use for keeping
 * the picker and the toggle agreeing inside this one.
 */
const CHANGED = 'cue:themechange';

function isChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (CHOICES as readonly string[]).includes(value);
}

/** What the document is currently painting. */
export function readTheme(): ThemeChoice {
  if (typeof document === 'undefined') return 'system';

  const applied = document.documentElement.dataset['theme'];
  return isChoice(applied) && applied !== 'system' ? applied : 'system';
}

/** Which dark scheme the toggle should reach for. */
export function readDarkVariant(): DarkVariant {
  const applied = readTheme();
  if (applied === 'dark' || applied === 'onyx') return applied;

  try {
    const stored = window.localStorage.getItem(DARK_VARIANT_KEY);
    return stored === 'onyx' ? 'onyx' : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * Whether what is on screen right now is a light scheme.
 *
 * Has to ask the media query for `system`, because that is the one state where
 * the answer lives in the OS rather than in the document.
 */
export function isLightNow(choice: ThemeChoice = readTheme()): boolean {
  if (choice === 'light') return true;
  if (choice !== 'system') return false;

  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
}

/**
 * Apply a choice, remember it, and tell everyone.
 *
 * The attribute is written first and storage second. Writing to storage can
 * throw — private browsing, a full quota — and losing the *memory* of a choice
 * is a much smaller failure than not applying the choice at all, so the part
 * that cannot fail goes first and the part that can is allowed to.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;

  if (choice === 'system') {
    delete root.dataset['theme'];
  } else {
    root.dataset['theme'] = choice;
  }

  try {
    if (choice === 'system') {
      window.localStorage.removeItem(THEME_KEY);
    } else {
      window.localStorage.setItem(THEME_KEY, choice);
      if (choice !== 'light') window.localStorage.setItem(DARK_VARIANT_KEY, choice);
    }
  } catch {
    // See above: the theme still changed for this session.
  }

  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Subscribe a component to the current choice.
 *
 * The server snapshot is `system` rather than the real value for the same
 * reason the choice is read after mount elsewhere: the server has no access to
 * `localStorage`, so any other answer is a guess that React would tear the tree
 * down over. The first paint is whatever the blocking script already painted;
 * this only settles the *controls* a moment later.
 */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readTheme, () => 'system' as const);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);

  // The OS flipping to dark at sunset changes what `system` resolves to, and
  // the toggle's icon is a claim about what is on screen rather than about
  // what was chosen — so it has to move too.
  const media = window.matchMedia('(prefers-color-scheme: light)');
  media.addEventListener('change', onChange);

  return () => {
    window.removeEventListener(CHANGED, onChange);
    media.removeEventListener('change', onChange);
  };
}
