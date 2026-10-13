import { DEFAULT_PREFERENCES, normalizePreferences, type PlaybackPreferences } from '@cue/core';
import { useSyncExternalStore } from 'react';

/**
 * Playback preferences, kept on the device.
 *
 * Deliberately local rather than on the account. Speed is a property of *how
 * you are listening right now* — phone speakers in a kitchen and headphones on
 * a train are not the same 1.5× — and syncing it would mean changing it on one
 * device silently changed it on the other.
 *
 * Read synchronously, because the player machine is constructed from it. An
 * async read would mean the first episode starts at 1× and jumps to the saved
 * speed a moment later, which is audible.
 */

const KEY = 'cue.playback-preferences';

export function readPreferences(): PlaybackPreferences {
  // No localStorage during server rendering, and there is nothing to restore
  // there anyway — the server has no listener.
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;

  try {
    const stored = window.localStorage.getItem(KEY);
    if (!stored) return DEFAULT_PREFERENCES;

    // Normalised rather than trusted: this is a store the user can edit, and
    // a previous version of this app may have written a shape we no longer use.
    return normalizePreferences(JSON.parse(stored));
  } catch {
    // Private mode, blocked storage, or unparseable JSON. Defaults work.
    return DEFAULT_PREFERENCES;
  }
}

export function writePreferences(preferences: PlaybackPreferences): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Failing to persist is not worth interrupting anyone for: the setting
    // still applies to this session, it just will not survive a reload.
  }

  // Announced after the write, so anything that re-reads on this event reads
  // the value that was stored rather than the one being replaced.
  window.dispatchEvent(new Event(CHANGED));
}

const CHANGED = 'cue:preferences-change';

/**
 * The preferences, for components that have to *draw* them.
 *
 * Reading them was never the problem — the machine does that synchronously at
 * construction, which is why this file had no hook. Drawing them was: the skip
 * controls were handed `SKIP_BACK_SEC`, the *constant*, while the machine
 * skipped by `preferences.skipBackSec`, which Settings lets a listener change.
 * Set skip-back to 30 and the button kept drawing "15", kept announcing "Skip
 * back 15 seconds", and jumped 30 — the control lying about its own size, in
 * the numeral and in the accessible name at once.
 *
 * A cached snapshot rather than a fresh `readPreferences()` per call, because
 * `useSyncExternalStore` compares by identity and parsing JSON returns a new
 * object every time — which is an infinite render loop, not a stale value.
 */
let snapshot: PlaybackPreferences | null = null;

export function usePlaybackPreferences(): PlaybackPreferences {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFERENCES);
}

function getSnapshot(): PlaybackPreferences {
  return (snapshot ??= readPreferences());
}

function subscribe(onChange: () => void): () => void {
  const refresh = () => {
    snapshot = readPreferences();
    onChange();
  };

  window.addEventListener(CHANGED, refresh);
  // `storage` fires only in *other* tabs, which is exactly the case the event
  // above cannot cover: change the skip interval in one tab and the player in
  // the next should not keep drawing the old number.
  window.addEventListener('storage', refresh);

  return () => {
    window.removeEventListener(CHANGED, refresh);
    window.removeEventListener('storage', refresh);
  };
}
