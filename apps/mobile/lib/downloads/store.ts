import {
  advanceDownload,
  completeDownload,
  EMPTY_INDEX,
  failDownload,
  forgetDownload,
  listDownloads,
  nextQueued,
  requestDownload,
  requeueInterrupted,
  startDownload,
  type DownloadIndex,
  type DownloadRecord,
  type PlayableEpisode,
} from '@cue/core';
import { useSyncExternalStore } from 'react';
import { deleteFiles, downloadEpisode, readIndex, reconcileWithDisk, writeIndex } from './files';

/**
 * The downloads singleton.
 *
 * The same shape as the player, and for the same reason: a transfer has to
 * outlive the screen that started it. Someone taps download on an episode,
 * navigates away, and the bytes keep moving — a store owned by a component
 * would cancel the download by unmounting, which is the one behaviour a
 * download manager must never have.
 *
 * All the decisions — what to start next, what a second tap means, what a
 * half-finished transfer becomes after a crash — live in `@cue/core` and are
 * tested there. What is here is the parts that need a device: the file system,
 * the network, and React.
 */

let index: DownloadIndex = EMPTY_INDEX;
let hydrated = false;

const listeners = new Set<() => void>();

/** In-flight transfers, so they can be cancelled. */
const active = new Map<string, AbortController>();

/**
 * Whether there is a network to download over.
 *
 * Pushed in by the connectivity layer rather than read from it, so this module
 * stays free of Expo imports and the queue can be driven by a test. Downloads
 * do not fail while offline — they wait, and resume on their own when the
 * connection returns, which is what someone who queued four episodes before
 * leaving the house is expecting.
 */
let online = true;

function set(next: DownloadIndex, persist = true): void {
  if (next === index) return;

  index = next;
  if (persist) writeIndex(index);
  for (const listener of listeners) listener();
}

/**
 * Load the index and reconcile it with what is actually on disk.
 *
 * Runs once, synchronously, on first use — including from inside a render,
 * which is why it does no work that could notify a listener. Two things are
 * fixed up here and nowhere else, because both are only true at startup: a
 * record whose file is gone is dropped, and a transfer the app was killed
 * during goes back in the queue — Android streams a download straight into its
 * destination file, so there is no partial transfer to resume, only a partial
 * file to replace.
 *
 * Restarting those goes on a microtask. Beginning a transfer changes state, and
 * state that changes during a render is React's oldest way to produce a warning
 * nobody can locate.
 */
function hydrate(): void {
  if (hydrated) return;
  hydrated = true;

  index = requeueInterrupted(reconcileWithDisk(readIndex()));
  writeIndex(index);

  // `queueMicrotask` is not in React Native's lib; a resolved promise is the
  // same tick and is.
  void Promise.resolve().then(pump);
}

// --------------------------------------------------------------- scheduling --

function pump(): void {
  if (!online) return;

  const episodeId = nextQueued(index);
  if (!episodeId) return;

  void run(episodeId);
}

async function run(episodeId: string): Promise<void> {
  set(startDownload(index, episodeId));

  const record = index[episodeId];
  if (!record) return;

  const controller = new AbortController();
  active.set(episodeId, controller);

  /**
   * Progress, at the rate a screen can use.
   *
   * The native side reports far more often than 4Hz, and every report that
   * reaches the store is a re-render of the Downloads list. The bar is smooth
   * enough at this rate, and the byte count that actually matters — the size on
   * disk — arrives with completion regardless.
   *
   * Not persisted, either: writing the index file several times a second to
   * record a number that is thrown away on the next launch would be pure cost.
   */
  let lastEmit = 0;

  try {
    const saved = await downloadEpisode(record, {
      signal: controller.signal,
      onProgress: (bytesWritten, bytesTotal) => {
        const now = Date.now();
        if (now - lastEmit < 250) return;
        lastEmit = now;
        set(advanceDownload(index, episodeId, bytesWritten, bytesTotal), false);
      },
    });

    // Cancelled while the last chunk was in the air: the record is already
    // gone and the files with it, so there is nothing to complete.
    if (!index[episodeId]) return;

    set(completeDownload(index, episodeId, saved, Date.now()));
  } catch (error) {
    // A cancellation is not a failure — the record was removed on purpose, and
    // marking it failed would resurrect a row the listener just deleted.
    if (controller.signal.aborted || !index[episodeId]) return;

    set(failDownload(index, episodeId, describe(error)));
  } finally {
    active.delete(episodeId);
    // Whatever happened, the slot is free.
    pump();
  }
}

/**
 * A transfer failure in words a listener can act on.
 *
 * The distinction that matters is whose problem it is: a publisher's dead link
 * is not something waiting will fix, and "no space left" is not something
 * retrying will.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/ENOSPC|no space|disk full/i.test(message)) return 'There is no room left on this device';
  if (/\b(4\d\d)\b/.test(message)) return 'The publisher no longer offers this file';
  if (/network|timeout|ETIMEDOUT|ECONN|unreachable/i.test(message)) {
    return 'The connection dropped part-way through';
  }

  return 'This episode could not be saved';
}

// ----------------------------------------------------------------- commands --

export const downloadActions = {
  /** Save an episode for offline listening. */
  save(episode: PlayableEpisode): void {
    hydrate();
    set(requestDownload(index, episode, Date.now()));
    pump();
  },

  /**
   * Remove an episode: cancel it if it is moving, delete its files, forget it.
   *
   * One verb for all three states on purpose. From the listener's side "get rid
   * of this" is a single intention, and a UI that offers Cancel, Delete and
   * Dismiss depending on a row's status is three ways to say it.
   */
  remove(episodeId: string): void {
    hydrate();

    const record = index[episodeId];
    if (!record) return;

    active.get(episodeId)?.abort();
    active.delete(episodeId);

    // Removed from the index first, so the row leaves the screen immediately
    // rather than after a file system round trip.
    set(forgetDownload(index, episodeId));
    deleteFiles(record);

    pump();
  },

  /** Retry a download that failed. */
  retry(episode: PlayableEpisode): void {
    hydrate();
    set(requestDownload(index, episode, Date.now()));
    pump();
  },

  /**
   * Tell the queue whether there is a connection.
   *
   * Coming back online restarts whatever was waiting, which is what makes a
   * queue built on the train home finish itself at the front door.
   */
  setOnline(next: boolean): void {
    if (online === next) return;
    online = next;
    if (online) {
      hydrate();
      pump();
    }
  },
};

// -------------------------------------------------------------- React glue --

/**
 * Watch the index.
 *
 * Exported as well as used by the hooks below, because the player has to know
 * when a download finishes — an episode queued before it was saved is holding
 * the publisher's URL, and nothing would ever swap it for the file.
 */
export function subscribeDownloads(listener: () => void): () => void {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const subscribe = subscribeDownloads;

/** The whole index. For screens that render every row. */
export function useDownloadIndex(): DownloadIndex {
  return useSyncExternalStore(subscribe, () => {
    hydrate();
    return index;
  });
}

/**
 * One episode's record.
 *
 * Separate from `useDownloadIndex` so a download button on an episode row does
 * not re-render four times a second because a *different* episode is
 * downloading — which, on a list, is every row at once.
 */
export function useDownloadRecord(episodeId: string): DownloadRecord | undefined {
  return useSyncExternalStore(subscribe, () => {
    hydrate();
    return index[episodeId];
  });
}

/** Ordered for the Downloads screen: moving first, then newest saved. */
export function useDownloads(): DownloadRecord[] {
  return listDownloads(useDownloadIndex());
}

/**
 * The index, read outside React.
 *
 * The player is a singleton created outside the tree and cannot use a hook, but
 * it has to know whether an episode is on disk before it loads a URL.
 */
export function currentDownloads(): DownloadIndex {
  hydrate();
  return index;
}
