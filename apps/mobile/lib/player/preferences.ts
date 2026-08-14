import { DEFAULT_PREFERENCES, normalizePreferences, type PlaybackPreferences } from '@cue/core';
import * as SecureStore from 'expo-secure-store';

/**
 * Playback preferences, kept on the handset.
 *
 * Deliberately local rather than on the account. Speed is a property of *how
 * you are listening right now* — a phone speaker in a kitchen and headphones
 * on a train are not the same 1.5× — and syncing it would mean changing it on
 * one device silently changed it on the other.
 *
 * Read synchronously, because the player machine is constructed from it. An
 * async read would mean the first episode starts at 1× and jumps to the saved
 * speed a moment later, which is audible.
 *
 * SecureStore is not chosen for secrecy — none of this is secret — but because
 * it is the synchronous key/value store already in the app. Adding
 * AsyncStorage for three numbers would be a dependency and an await.
 */

const KEY = 'cue.playback-preferences';

export function readPreferences(): PlaybackPreferences {
  try {
    const stored = SecureStore.getItem(KEY);
    if (!stored) return DEFAULT_PREFERENCES;

    // Normalised rather than trusted: a previous version of this app may have
    // written a shape we no longer use.
    return normalizePreferences(JSON.parse(stored));
  } catch {
    // Unavailable keystore or unparseable JSON. Defaults work.
    return DEFAULT_PREFERENCES;
  }
}

export function writePreferences(preferences: PlaybackPreferences): void {
  try {
    SecureStore.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Failing to persist is not worth interrupting anyone for: the setting
    // still applies to this session, it just will not survive a restart.
  }
}
