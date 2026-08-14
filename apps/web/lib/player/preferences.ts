import { DEFAULT_PREFERENCES, normalizePreferences, type PlaybackPreferences } from '@cue/core';

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
}
