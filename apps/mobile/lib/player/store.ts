import { applyQueueMutation } from '@cue/api-client';
import {
  PlayerMachine,
  playableFromQueueEntry,
  preferLocal,
  preferLocalAll,
  type PlayableEpisode,
  type PlaybackPreferences,
  type PlaybackRate,
  type PlayerState,
  type ProgressRecord,
} from '@cue/core';
import { requestNotificationPermissionsAsync } from 'expo-audio';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { api } from '@/lib/api';
import { isOnline } from '@/lib/connectivity';
import { currentDownloads, subscribeDownloads } from '@/lib/downloads/store';
import { clearHeldProgress, holdProgress } from '@/lib/sync/outbox';
import { NativeAudioEngine } from './native-engine';
import { readPreferences, writePreferences } from './preferences';

/**
 * The player singleton.
 *
 * Created lazily on first use and never torn down, so playback survives every
 * screen change and every component unmount. React subscribes to it; it does
 * not live inside React.
 */
let machine: PlayerMachine | null = null;
let engine: NativeAudioEngine | null = null;

/**
 * Identifies this handset to the sync layer.
 *
 * Persisted so a restart is the *same* device rather than a new one —
 * otherwise every launch would look like a peer racing itself, and
 * reconciliation would be comparing a device against its own ghost.
 */
const DEVICE_KEY = 'cue.device-id';
let deviceIdCache: string | null = null;

function deviceId(): string {
  if (deviceIdCache) return deviceIdCache;

  try {
    const existing = SecureStore.getItem(DEVICE_KEY);
    if (existing) {
      deviceIdCache = existing;
      return existing;
    }

    const created = randomId();
    SecureStore.setItem(DEVICE_KEY, created);
    deviceIdCache = created;
    return created;
  } catch {
    // Keystore unavailable. A per-session id still works; it just makes this
    // launch look like a new device.
    deviceIdCache = randomId();
    return deviceIdCache;
  }
}

/**
 * `crypto.randomUUID` is present on some React Native runtimes and absent on
 * others, so it is used when there and substituted when not. This identifies a
 * device to a sync algorithm — it is not a secret, and does not need to be
 * unguessable.
 */
function randomId(): string {
  // Not typed on React Native's lib, so it is reached through a narrow cast
  // rather than by widening the whole global.
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Persisting position.
 *
 * Debounced, because the machine reports every few seconds and a request per
 * report would be both wasteful and pointless on a metered mobile connection.
 * The important writes are the undebounced ones: pause, and backgrounding.
 */
const PROGRESS_INTERVAL_MS = 15_000;
let lastWrite = 0;
let pendingEpisodeId: string | null = null;

/**
 * Whether there is anyone to sync *to*.
 *
 * Every user-scoped endpoint answers 401 without a session, so an anonymous
 * listener was firing a guaranteed failure on every play and every enqueue.
 * On a phone that is worse than on the web: it is a radio wake and metered
 * bytes spent on a request that cannot succeed.
 *
 * Three states rather than a boolean, because "not signed in" and "we have not
 * asked yet" are different. Only a *confirmed* anonymous session suppresses a
 * request; during `unknown` the resume lookup still goes out, so someone who
 * opens the app and immediately presses play does not lose their position.
 */
type SyncState = 'unknown' | 'anonymous' | 'authenticated';

let syncState: SyncState = 'unknown';

export function setSyncState(next: SyncState): void {
  syncState = next;
}

function canSync(): boolean {
  return syncState !== 'anonymous';
}

function reportProgress(episodeId: string, record: ProgressRecord, force: boolean): void {
  // Checked before the debounce bookkeeping, so a signed-out session does not
  // leave `lastWrite` set and swallow the first real write after a sign-in.
  if (!canSync()) return;

  const now = Date.now();
  if (!force && now - lastWrite < PROGRESS_INTERVAL_MS) return;
  lastWrite = now;

  const held = {
    episodeId,
    positionSec: record.positionSec,
    durationSec: record.durationSec,
    completed: record.completed,
    deviceId: record.deviceId,
    // The moment playback was here, not the moment it was sent. The server
    // reconciles against other devices by this, so stamping it at send time
    // would make an hour-old position look like the newest anyone reported and
    // rewind a device that was genuinely ahead.
    observedAt: record.updatedAt,
  };

  // Known offline: hold it rather than firing a request that cannot land. On a
  // phone this is not an edge case — it is the tunnel, the lift, the flight.
  if (!isOnline()) {
    holdProgress(held);
    return;
  }

  void api
    .reportProgress(episodeId, {
      positionSec: Math.round(held.positionSec),
      durationSec: held.durationSec,
      completed: held.completed,
      deviceId: held.deviceId,
      observedAt: held.observedAt,
    })
    .catch(() => {
      // Connectivity we believed in but did not have — a captive portal, a
      // half-attached cell. Held for the next reconnect rather than dropped:
      // this write is where someone's place in an episode lives.
      holdProgress(held);
    });
}

export function getPlayer(): PlayerMachine {
  if (machine) return machine;

  engine = new NativeAudioEngine();
  machine = new PlayerMachine({
    engine,
    deviceId: deviceId(),
    preferences: readPreferences(),
    onProgress: (record) => {
      if (!pendingEpisodeId) return;
      reportProgress(pendingEpisodeId, record, false);
    },
    onQueueMutation: (mutation) => {
      if (!canSync()) return;

      void applyQueueMutation(api, mutation).catch(() => {
        // The write failed — the normal case on a phone rather than the
        // exception. The queue on screen is already correct and playback
        // follows it; the cost is only that this change does not reach another
        // device.
      });
    },
  });

  let lastEpisodeId: string | null = null;

  machine.subscribe((state) => {
    pendingEpisodeId = state.current?.id ?? null;

    if (state.current && state.current.id !== lastEpisodeId) {
      lastEpisodeId = state.current.id;
      updateLockScreen(state.current);
    }
  });

  /**
   * The last write before the app goes away.
   *
   * Android kills a backgrounded process without warning, and losing the final
   * position is exactly the failure this subsystem exists to prevent. Audio
   * itself keeps playing — that is what the foreground service is for — so this
   * is about the *record* of where playback got to, not about playback.
   */
  AppState.addEventListener('change', (next) => {
    if (next === 'background' || next === 'inactive') flushProgress();
  });

  watchDownloads(machine);

  return machine;
}

/**
 * Point queued episodes at their files as they finish downloading.
 *
 * The ordinary case is handled where episodes enter the player: everything is
 * resolved against the index on the way in. The case that needs this is the
 * other order — queue four episodes, *then* download them, then get on a train.
 * Those queue entries are holding publisher URLs, and without this the player
 * would stream episodes that are already on the device.
 *
 * `hydrateQueue` rather than a reorder: it replaces the queue without echoing
 * the change back to the server, which is right, because nothing about the
 * queue has actually changed — only where each episode is read from.
 */
function watchDownloads(player: PlayerMachine): void {
  // Only completions matter, and they are rare. Comparing a signature keeps a
  // progress tick four times a second from rewriting the queue.
  let lastSaved = '';

  subscribeDownloads(() => {
    const index = currentDownloads();
    const signature = Object.values(index)
      .filter((record) => record.status === 'complete')
      .map((record) => record.episodeId)
      .sort()
      .join(',');

    if (signature === lastSaved) return;
    lastSaved = signature;

    const queue = player.getState().queue;
    if (queue.length === 0) return;

    // `preferLocal` returns the very same episode when there is nothing to
    // swap, so identity is an exact test for "would this change anything".
    const resolved = preferLocalAll(queue, index);
    if (resolved.every((episode, position) => episode === queue[position])) return;

    player.hydrateQueue(resolved);
  });
}

function flushProgress(): void {
  const current = machine?.getState().current;
  if (!current || !machine) return;

  const state = machine.getState();

  reportProgress(
    current.id,
    {
      positionSec: engine?.getPosition() ?? state.positionSec,
      durationSec: state.durationSec,
      completed: false,
      deviceId: deviceId(),
      updatedAt: Date.now(),
    },
    true,
  );
}

/**
 * OS-level media controls.
 *
 * This is what puts the episode in the notification shade and on the lock
 * screen. On Android it does more than that: without an active lock-screen
 * session the OS stops a backgrounded app's audio after roughly three minutes,
 * so this call is what makes background playback last a whole episode.
 */
function updateLockScreen(episode: PlayableEpisode): void {
  if (!engine) return;

  // Android 13 and later will not show the media notification without this.
  // Asked for on first playback rather than at launch, where a notification
  // prompt before anything has happened reads as a shakedown.
  void requestNotificationPermissionsAsync().catch(() => undefined);

  engine.nativePlayer.setActiveForLockScreen(
    true,
    {
      title: episode.title,
      artist: episode.podcastTitle,
      ...(episode.artworkUrl ? { artworkUrl: episode.artworkUrl } : {}),
    },
    { showSeekForward: true, showSeekBackward: true },
  );
}

// -------------------------------------------------------------- React glue --

/**
 * Subscribe React to the machine.
 *
 * `useSyncExternalStore` rather than an effect: it is the API designed for
 * exactly this — an external mutable source — and it avoids the tearing that an
 * effect-based subscription produces under concurrent rendering.
 */
export function usePlayerState(): PlayerState {
  return useSyncExternalStore(
    (onChange) => getPlayer().subscribe(onChange),
    () => getPlayer().getState(),
  );
}

/** Commands, stable across renders. */
export function usePlayerActions() {
  return playerActions;
}

export const playerActions = {
  play: async (episode: PlayableEpisode) => {
    const player = getPlayer();

    // Play the copy on disk when there is one. Done here rather than inside the
    // machine so the player stays unaware that downloads exist — it is handed
    // an episode and a URL, and where that URL points is not its problem.
    const source = preferLocal(episode, currentDownloads());

    // Resume where this listener left off, reconciled server-side. There is
    // nothing stored for an anonymous listener, so the lookup is skipped
    // rather than sent and refused.
    let resumeFrom: ProgressRecord | null = null;
    if (canSync()) {
      try {
        const { progress } = await api.getProgress(episode.id);
        if (progress) {
          resumeFrom = {
            positionSec: progress.positionSec,
            durationSec: progress.durationSec,
            completed: progress.completed,
            deviceId: progress.deviceId,
            updatedAt: new Date(progress.updatedAt).getTime(),
          };
        }
      } catch {
        // Offline, or the request failed. Starting from wherever this device
        // last knew about is the right fallback — better than refusing to play
        // an episode that is sitting on the handset.
      }
    }

    await player.play(source, resumeFrom);
  },
  /**
   * Play from an exact point, ignoring wherever this listener had got to.
   *
   * For a shared link. The resume lookup is skipped deliberately: somebody who
   * followed "listen from 24:31" wants 24:31, not the place they abandoned the
   * episode last week.
   */
  playAt: async (episode: PlayableEpisode, positionSec: number) => {
    await getPlayer().playAt(preferLocal(episode, currentDownloads()), positionSec);
  },
  toggle: () => void getPlayer().toggle(),
  pause: () => getPlayer().pause(),
  seek: (sec: number) => getPlayer().seek(sec),
  skipBack: () => getPlayer().skipBack(),
  skipForward: () => getPlayer().skipForward(),
  setRate: (rate: PlaybackRate) => {
    const player = getPlayer();
    player.setRate(rate);
    // Speed changed from the player is the same setting as speed changed from
    // Settings, so it persists the same way. Otherwise the two agree only
    // until the next restart.
    writePreferences(player.getPreferences());
  },
  setSleepTimer: (minutes: number | null) => getPlayer().setSleepTimer(minutes),
  next: () => void getPlayer().next(),
  // Resolved on the way in, so an episode that was already saved plays from
  // disk when the queue reaches it — including with no connection left.
  enqueue: (...episodes: PlayableEpisode[]) =>
    getPlayer().enqueue(...preferLocalAll(episodes, currentDownloads())),
  playNext: (episode: PlayableEpisode) =>
    getPlayer().playNext(preferLocal(episode, currentDownloads())),
  removeFromQueue: (episodeId: string) => getPlayer().removeFromQueue(episodeId),
  reorderQueue: (episodeIds: string[]) => getPlayer().reorderQueue(episodeIds),
  clearQueue: () => getPlayer().clearQueue(),
};

/** Read the live position without re-rendering — for the interpolated scrubber. */
export function readPosition(): number {
  return engine?.getPosition() ?? 0;
}

/** Apply changed settings to the running player and remember them. */
export function updatePreferences(preferences: PlaybackPreferences): void {
  getPlayer().setPreferences(preferences);
  writePreferences(preferences);
}

export { readPreferences };

/**
 * Load the stored queue into the player.
 *
 * Once per session. Re-running it would discard local changes that have not
 * been written yet, which on a mobile connection is most of them — and the
 * symptom is an episode you just queued vanishing a second later.
 *
 * Anonymous listeners never reach this: their queue lives only in the machine,
 * which is the correct behaviour rather than a limitation.
 */
let hydrated = false;

export async function hydrateQueue(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  try {
    const { items } = await api.getQueue();
    getPlayer().hydrateQueue(
      preferLocalAll(items.map(playableFromQueueEntry), currentDownloads()),
    );
  } catch {
    // Signed out or offline. An empty local queue is the right fallback, and
    // the next launch will try again.
    hydrated = false;
  }
}

/**
 * Forget the queue on sign-out.
 *
 * It belonged to the person who just left, and the next person to sign in on
 * this handset must not inherit it — nor find it silently merged with their
 * own on the first write.
 *
 * `hydrateQueue([])` rather than `clearQueue()`: clearing is a local edit and
 * would be dutifully written to the server, deleting the departing listener's
 * queue from every device they own.
 */
export function resetQueue(): void {
  hydrated = false;
  getPlayer().hydrateQueue([]);

  // Held positions belonged to the person who just left. Flushing them after
  // the next sign-in would write their listening history onto someone else's
  // account — signing out is not a reason to sync harder.
  clearHeldProgress();
}
