'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the whole app takes its colour from what is playing.
 *
 * A podcast page already repaints itself in its show's colour, and the resume
 * hero on Home does the same. This extends that to the *window*: with it on,
 * whatever is currently playing tints every screen — Home, Search, Library,
 * Settings — and the colour changes when the episode does.
 *
 * **Off by default, and a setting rather than a behaviour.** A palette that
 * moves under you while you are reading is a real cost, not only a taste: it
 * re-grounds every surface on the screen at a moment you did not choose, which
 * some people find lively and others find restless. The app's own neutral
 * ground is also what makes forty different shows feel like one product, and
 * spending that everywhere is a decision worth asking for rather than assuming.
 *
 * Stored per browser rather than per account, exactly as the theme is. It is a
 * property of how this screen is being looked at.
 */

const KEY = 'cue-now-playing-tint';

/** Broadcast, because the setting and the painter are different components. */
const CHANGED = 'cue:nowplayingtintchange';

export function readNowPlayingTint(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(KEY) === 'on';
  } catch {
    // Private mode or blocked storage. Off is the safe answer: it is the
    // default, and it is the one that cannot surprise anybody.
    return false;
  }
}

export function setNowPlayingTint(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(KEY, 'on');
    else window.localStorage.removeItem(KEY);
  } catch {
    // The setting still applies for this session, which is what is being
    // watched. Losing the memory of it is the smaller failure.
  }

  window.dispatchEvent(new Event(CHANGED));
}

/**
 * Subscribe a component to the setting.
 *
 * The server snapshot is `false` rather than the stored value, for the same
 * reason the theme's is `system`: the server cannot read `localStorage`, and
 * any other answer is a guess React would tear the tree down over.
 */
export function useNowPlayingTint(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(CHANGED, onChange);
      return () => window.removeEventListener(CHANGED, onChange);
    },
    readNowPlayingTint,
    () => false,
  );
}
