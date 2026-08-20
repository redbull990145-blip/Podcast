'use client';

import { applyQueueMutation } from '@cue/api-client';
import {
  PlaybackClock,
  PlayerMachine,
  playableFromQueueEntry,
  type PlayableEpisode,
  type PlaybackPreferences,
  type PlaybackRate,
  type PlayerState,
  type ProgressRecord,
} from '@cue/core';
import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { readPreferences, writePreferences } from './preferences';
import { WebAudioEngine } from './web-engine';

/**
 * The player singleton.
 *
 * Created lazily on first use and never torn down, so playback survives every
 * route change and every component unmount. React subscribes to it; it does
 * not live inside React.
 */
let machine: PlayerMachine | null = null;
let engine: WebAudioEngine | null = null;

/**
 * Identifies this browser to the sync layer.
 *
 * Persisted so a reload is the *same* device rather than a new one — otherwise
 * every refresh would look like a peer racing itself, and reconciliation would
 * be comparing a device against its own ghost.
 */
function deviceId(): string {
  const KEY = 'cue.device-id';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    // Private mode or blocked storage. A per-session id still works; it just
    // makes this tab look like a new device each time.
    return 'ephemeral';
  }
}

/**
 * Whether there is anyone to sync *to*.
 *
 * Every user-scoped endpoint answers 401 without a session, so an anonymous
 * listener was firing a guaranteed failure on every play and every enqueue.
 * Nothing broke — the queue is local by design and playback never depended on
 * the write — but a request that cannot succeed should not be sent.
 *
 * Three states rather than a boolean, because "not signed in" and "we have not
 * asked yet" are different. Suppressing during `unknown` would mean a listener
 * who hits play before `/me` returns silently loses their resume position, so
 * only a *confirmed* anonymous session stops a request.
 *
 * The player is a module singleton created outside React, so it cannot read the
 * session itself. The shell pushes it down once the query resolves.
 */
type SyncState = 'unknown' | 'anonymous' | 'authenticated';

let syncState: SyncState = 'unknown';

export function setSyncState(next: SyncState): void {
  syncState = next;
}

function canSync(): boolean {
  return syncState !== 'anonymous';
}

/**
 * Persisting position.
 *
 * Debounced, because the machine reports every few seconds and a request per
 * report would be both wasteful and pointless — nothing reads it that often.
 * The important writes are the undebounced ones: pause, and page unload.
 */
const PROGRESS_INTERVAL_MS = 15_000;
let lastWrite = 0;
let pendingEpisodeId: string | null = null;

function reportProgress(episodeId: string, record: ProgressRecord, force: boolean): void {
  // Checked before the debounce bookkeeping, so a signed-out session does not
  // leave `lastWrite` set and swallow the first real write after a sign-in.
  if (!canSync()) return;

  const now = Date.now();
  if (!force && now - lastWrite < PROGRESS_INTERVAL_MS) return;
  lastWrite = now;

  void api
    .reportProgress(episodeId, {
      positionSec: Math.round(record.positionSec),
      durationSec: record.durationSec,
      completed: record.completed,
      deviceId: record.deviceId,
      observedAt: record.updatedAt,
    })
    .catch(() => {
      // A dropped progress write is not worth interrupting listening for. The
      // next one carries a later position anyway, so nothing is lost that the
      // following heartbeat does not fix.
    });
}

export function getPlayer(): PlayerMachine {
  if (machine) return machine;

  engine = new WebAudioEngine();
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
        // The write failed. The queue on screen is already correct and playback
        // follows it, so the cost is that this change is not carried to another
        // device — not that the listener loses it.
      });
    },
  });

  machine.subscribe((state) => {
    pendingEpisodeId = state.current?.id ?? null;
    updateMediaSession(state);
  });

  /**
   * The last write.
   *
   * `visibilitychange` rather than `beforeunload`: mobile browsers routinely
   * kill a backgrounded tab without ever firing unload, and losing the final
   * position is exactly the failure this whole subsystem exists to prevent.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProgress();
  });
  window.addEventListener('pagehide', flushProgress);

  return machine;
}

function flushProgress(): void {
  if (!canSync()) return;

  const current = machine?.getState().current;
  if (!current || !engine) return;

  const state = machine!.getState();

  // `sendBeacon` survives the page going away, which a normal fetch does not.
  const payload = JSON.stringify({
    positionSec: Math.round(engine.getPosition()),
    durationSec: state.durationSec,
    completed: false,
    deviceId: deviceId(),
    observedAt: Date.now(),
  });

  const url = `${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8080'}/me/progress/${current.id}`;

  // Beacon cannot send cookies cross-origin in every browser, so fall back to
  // a keepalive fetch, which can.
  //
  // The rejection is caught on the promise, not in a `try`. `fetch` fails
  // asynchronously — a surrounding try/catch sees nothing and the failure
  // surfaces as an unhandled rejection instead, which is what a server that is
  // simply not running produced here, once per page hide.
  fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Nothing more to try; the page is going away.
  });
}

/**
 * OS-level media controls.
 *
 * This is what puts the episode on the lock screen, in the notification
 * shade, and under the keyboard's media keys. Without it, hardware play/pause
 * does nothing and the browser shows a generic "playing audio" tab with no
 * idea what it is.
 */
function updateMediaSession(state: PlayerState): void {
  if (!('mediaSession' in navigator) || !state.current) return;

  const episode = state.current;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: episode.title,
    artist: episode.podcastTitle,
    ...(episode.artworkUrl
      ? { artwork: [{ src: episode.artworkUrl, sizes: '512x512', type: 'image/jpeg' }] }
      : {}),
  });

  navigator.mediaSession.playbackState =
    state.status === 'playing' ? 'playing' : state.status === 'paused' ? 'paused' : 'none';

  const player = getPlayer();
  navigator.mediaSession.setActionHandler('play', () => void player.resume());
  navigator.mediaSession.setActionHandler('pause', () => player.pause());
  navigator.mediaSession.setActionHandler('seekbackward', () => player.skipBack());
  navigator.mediaSession.setActionHandler('seekforward', () => player.skipForward());
  navigator.mediaSession.setActionHandler('nexttrack', () => void player.next());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime !== undefined) player.seek(details.seekTime);
  });

  // Drives the scrubber the OS itself draws on the lock screen.
  if (state.durationSec !== null && Number.isFinite(state.durationSec)) {
    try {
      navigator.mediaSession.setPositionState({
        duration: state.durationSec,
        playbackRate: state.rate,
        position: Math.min(state.positionSec, state.durationSec),
      });
    } catch {
      // Throws if position exceeds duration during a seek race. Harmless.
    }
  }
}

// -------------------------------------------------------------- React glue --

const SERVER_STATE: PlayerState = {
  status: 'idle',
  current: null,
  queue: [],
  positionSec: 0,
  durationSec: null,
  rate: 1,
  volume: 1,
  sleepAtMs: null,
  error: null,
};

/**
 * Subscribe React to the machine.
 *
 * `useSyncExternalStore` rather than an effect: it is the API designed for
 * exactly this — an external mutable source — and it avoids the tearing that
 * an effect-based subscription produces under concurrent rendering.
 */
export function usePlayerState(): PlayerState {
  return useSyncExternalStore(
    (onChange) => getPlayer().subscribe(onChange),
    () => getPlayer().getState(),
    () => SERVER_STATE,
  );
}

/** Commands, stable across renders. */
export function usePlayerActions() {
  return {
    play: async (episode: PlayableEpisode) => {
      const player = getPlayer();
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
          // The request failed. Starting from the beginning is the right
          // fallback — better than refusing to play.
        }
      }

      await player.play(episode, resumeFrom);
    },
    /**
     * Play from an exact point, ignoring wherever this listener had got to.
     *
     * For a shared link. The resume lookup is skipped deliberately: someone who
     * followed "listen from 24:31" wants 24:31, not the place they abandoned
     * the episode last week.
     */
    playAt: async (episode: PlayableEpisode, positionSec: number) => {
      await getPlayer().playAt(episode, positionSec);
    },
    toggle: () => void getPlayer().toggle(),
    pause: () => getPlayer().pause(),
    // Every deliberate move of the playhead re-anchors the smoothing model.
    // Without it a small backwards seek is indistinguishable from drift.
    seek: (sec: number) => {
      resyncClock();
      getPlayer().seek(sec);
    },
    skipBack: () => {
      resyncClock();
      getPlayer().skipBack();
    },
    skipForward: () => {
      resyncClock();
      getPlayer().skipForward();
    },
    setRate: (rate: PlaybackRate) => {
      const player = getPlayer();
      // The model extrapolates by wall time scaled by rate, so the rate
      // changing mid-flight invalidates the step it is part-way through.
      resyncClock();
      player.setRate(rate);
      // Speed changed from the player is the same setting as speed changed
      // from Settings, so it persists the same way. Otherwise the two agree
      // only until the next reload.
      writePreferences(player.getPreferences());
    },
    /**
     * Volume goes through the machine, never straight at `audio.volume`.
     *
     * The element would honour a direct write — it is a singleton, so the value
     * would even survive the next episode. What it would not do is tell anyone.
     * `state.volume` is what the slider renders, so a direct write moves the
     * audio and leaves the control sitting where it was, which is the shape of
     * a slider that does not work. The clamp is there too, and tested.
     */
    setVolume: (volume: number) => getPlayer().setVolume(volume),
    setSleepTimer: (minutes: number | null) => getPlayer().setSleepTimer(minutes),
    next: () => void getPlayer().next(),
    enqueue: (...episodes: PlayableEpisode[]) => getPlayer().enqueue(...episodes),
    playNext: (episode: PlayableEpisode) => getPlayer().playNext(episode),
    removeFromQueue: (episodeId: string) => getPlayer().removeFromQueue(episodeId),
    reorderQueue: (episodeIds: string[]) => getPlayer().reorderQueue(episodeIds),
    clearQueue: () => getPlayer().clearQueue(),
  };
}

/**
 * The model that turns the element's stepped clock into a continuous one.
 *
 * A module singleton alongside the engine, because there is exactly one
 * playhead. See `PlaybackClock` for why sampling `currentTime` directly is not
 * good enough to drive a caption sweep.
 */
const clock = new PlaybackClock();

/**
 * The last answer, and the instant it was computed for.
 *
 * Reading the clock *advances* it — one easing step per call — so the number of
 * components that happen to be mounted would otherwise change how smooth the
 * motion is. Three consumers on the same frame (scrubber, captions, transcript
 * panel) took three steps instead of one, which both over-smoothed the model
 * and handed the three of them different answers for the same moment.
 *
 * Memoising on the frame's timestamp makes the read idempotent within a frame:
 * everything painted together sees one position, and the model advances once
 * per frame no matter who is watching.
 */
let lastReadAtMs = -1;
let lastReadSec = 0;

/**
 * Read the live position without re-rendering — for rAF-driven progress.
 *
 * Smoothed, not raw. Every caller is a render loop: the scrubber and the
 * caption sweep, both of which run at the display's refresh rate against a
 * clock that only advances 25 times a second. Progress *reporting* does not
 * come through here — it takes its positions from the machine — so nothing
 * durable is ever written from the model.
 */
export function readPosition(): number {
  if (!engine) return 0;

  const nowMs = performance.now();
  if (nowMs === lastReadAtMs) return lastReadSec;

  const state = machine?.getState();
  lastReadAtMs = nowMs;
  lastReadSec = clock.read(engine.getPosition(), {
    playing: state?.status === 'playing',
    rate: state?.rate ?? 1,
    nowMs,
  });

  return lastReadSec;
}

/**
 * Tell the clock the playhead moved on purpose.
 *
 * A seek while playing leaves `status` untouched, so the model has no way to
 * tell a deliberate jump from its own drift and falls back on a threshold. A
 * *small* backwards seek — tapping a caption line that has only just begun —
 * lands under that threshold, where the model's "never run backwards" guard
 * pins it until the audio catches up: up to a quarter of a second of frozen
 * sweep. Saying so explicitly is cheaper and surer than tuning the threshold.
 */
function resyncClock(): void {
  clock.reset();
  lastReadAtMs = -1;
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
 * been written yet, which on a slow connection is most of them — and the
 * symptom is an episode you just queued vanishing a second later.
 *
 * Anonymous listeners never reach this: their queue lives only in the machine,
 * which is the correct behaviour rather than a limitation. Nothing that can
 * work signed-out requires an account.
 */
let hydrated = false;

export async function hydrateQueue(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  try {
    const { items } = await api.getQueue();
    getPlayer().hydrateQueue(items.map(playableFromQueueEntry));
  } catch {
    // Signed out or offline. An empty local queue is the right fallback.
    hydrated = false;
  }
}

/**
 * Forget the queue on sign-out.
 *
 * It belonged to the person who just left, and the next person to sign in on
 * this browser must not inherit it — nor find it silently merged with their
 * own on the first write.
 *
 * `hydrateQueue([])` rather than `clearQueue()`: clearing is a local edit and
 * would be dutifully written to the server, deleting the departing listener's
 * queue from every device they own.
 */
export function resetQueue(): void {
  hydrated = false;
  getPlayer().hydrateQueue([]);
}
