'use client';

import { measure } from '@cue/design';
import { useSyncExternalStore } from 'react';

/**
 * Whether the desktop rail is folded to icons.
 *
 * Shared state rather than a `useState` in the shell, because three things need
 * the answer and only one of them is inside the sidebar: the rail draws itself
 * from it, the content gutter is sized by it, and the player bar starts where
 * the rail ends — the bar is rendered outside `<main>` so that playback
 * survives navigation, which puts it out of reach of any state the shell could
 * hold locally.
 *
 * `document` is the source of truth for the same reason it is for the theme: a
 * blocking script in `app/layout.tsx` reads storage before the first paint, so
 * the rail is already the right width when the page appears rather than
 * snapping 260 → 72 a frame after hydration.
 */

/** Matches the key in the pre-paint script in `app/layout.tsx`. */
export const RAIL_KEY = 'cue-rail';

const CHANGED = 'cue:railchange';

export function isRailCollapsed(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset['rail'] === 'collapsed';
}

/**
 * The rail's width in pixels, for the one consumer that cannot use CSS.
 *
 * Everything laid out in CSS reads `--measure-sidebar`, which this keeps in
 * step. The player positions its bar from JavaScript — it animates that inset
 * as a motion value during the expand gesture — so it needs the number.
 */
export function railWidth(collapsed = isRailCollapsed()): number {
  return collapsed ? measure.sidebarCollapsed : measure.sidebar;
}

export function setRailCollapsed(collapsed: boolean): void {
  const root = document.documentElement;

  if (collapsed) {
    root.dataset['rail'] = 'collapsed';
    // The custom property is overridden on the element the stylesheet declares
    // it on, so every `var(--measure-sidebar)` in the app — the content gutter,
    // the rail's own width — follows without any of them knowing the rail can
    // fold. Setting it here rather than in a class is what keeps the number in
    // one place instead of two.
    root.style.setProperty('--measure-sidebar', `${measure.sidebarCollapsed}px`);
  } else {
    delete root.dataset['rail'];
    root.style.removeProperty('--measure-sidebar');
  }

  try {
    if (collapsed) window.localStorage.setItem(RAIL_KEY, 'collapsed');
    else window.localStorage.removeItem(RAIL_KEY);
  } catch {
    // Private browsing. The rail still folds; only the memory of it is lost.
  }

  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Expanded is the server snapshot, always.
 *
 * The server cannot read storage, so this has to be a fixed guess, and it has
 * to be the *same* guess the pre-paint script starts from — otherwise React
 * hydrates against markup the script has already changed. Expanded is also the
 * safer of the two to be wrong about: a rail that arrives wide and folds is a
 * layout that settles, one that arrives narrow and opens shoves the page.
 */
export function useRailCollapsed(): boolean {
  return useSyncExternalStore(subscribe, isRailCollapsed, () => false);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}
