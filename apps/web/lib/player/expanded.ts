'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the expanded player is open.
 *
 * Shared state rather than a `useState` inside the player, for the same reason
 * the rail's fold is shared: the thing that has to react to it is not below the
 * thing that owns it. The player is rendered as a sibling of the rail, the page
 * and the tab bar — outside `<main>`, so that playback survives a route change —
 * which means it can no more hand them a prop than they can reach into it.
 *
 * What they need it for is `inert`. A sheet that covers the window while the
 * page behind it is still tabbable is not a modal, it is a very large div; the
 * shell marks its three regions inert while this is true, and that is the whole
 * consumer list.
 *
 * Ephemeral on purpose — no storage, no `document` dataset. The rail's fold is a
 * preference that has to survive a reload and therefore has to be in the DOM
 * before the first paint. This is a gesture, and a page that reloaded with the
 * player already open would be a page that reloaded with its own navigation
 * switched off.
 */

const CHANGED = 'cue:player-expanded';

let expanded = false;

export function setPlayerExpanded(next: boolean): void {
  if (expanded === next) return;
  expanded = next;
  window.dispatchEvent(new Event(CHANGED));
}

export function usePlayerExpanded(): boolean {
  // Closed is the server snapshot, and it is not a guess: nothing is playing
  // until someone presses play, so the player does not exist in the first
  // render at all.
  return useSyncExternalStore(subscribe, () => expanded, () => false);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}
