/**
 * Reconciling playback position across devices.
 *
 * The scenario this exists for: you listen on the phone to 37:24, put it down,
 * and open the web app. The web app must resume at 37:24 — but it may still be
 * holding its own stale record from three days ago, and both records claim to
 * be the truth.
 *
 * Last-write-wins on its own is wrong here, and wrong in the way users actually
 * notice. Two devices playing the same episode both report progress every ~15
 * seconds. Whichever packet happens to land second wins, so a phone that was
 * genuinely 20 minutes ahead gets rewound by a laptop that was left paused on
 * the same episode. Being rewound is far worse than being nudged forward: you
 * lose your place and have to hunt for it.
 *
 * So the rule is: **when two records are close in time, the further position
 * wins; when they are far apart in time, the newer one wins.** Close together
 * means concurrent playback, where position is the better signal. Far apart
 * means a genuine later session, where recency is.
 */

export type ProgressRecord = {
  positionSec: number;
  durationSec: number | null;
  /** Epoch milliseconds. */
  updatedAt: number;
  /** Which device wrote it. Distinguishes "my own echo" from a real peer. */
  deviceId: string;
  completed: boolean;
};

/**
 * Records written within this window of each other are treated as concurrent
 * playback rather than as a sequence. Progress is reported roughly every 15s,
 * so a minute comfortably covers a few in-flight writes without swallowing a
 * genuinely later listening session.
 */
export const CONCURRENT_WINDOW_MS = 60_000;

/**
 * How close to the end counts as finished.
 *
 * Publishers pad the end of episodes with outros and ads, and almost nobody
 * listens to the final seconds. Treating the last 30s as complete is what stops
 * an episode you finished from sitting in the queue forever asking to be
 * resumed at 59:47 of 60:00.
 */
export const COMPLETION_THRESHOLD_SEC = 30;

export type Reconciliation = {
  winner: ProgressRecord;
  /** Why, so the decision can be logged and understood rather than guessed at. */
  reason: 'only-record' | 'further-position' | 'more-recent' | 'completed';
};

export function reconcileProgress(
  local: ProgressRecord | null,
  remote: ProgressRecord | null,
): Reconciliation | null {
  if (!local && !remote) return null;
  if (!local) return { winner: remote!, reason: 'only-record' };
  if (!remote) return { winner: local, reason: 'only-record' };

  // Finishing is a deliberate act and should not be undone by a stale record
  // from a device that was paused mid-episode.
  if (local.completed !== remote.completed) {
    return { winner: local.completed ? local : remote, reason: 'completed' };
  }

  const apart = Math.abs(local.updatedAt - remote.updatedAt);

  if (apart <= CONCURRENT_WINDOW_MS) {
    // Concurrent. Position is the better signal, and being nudged forward is
    // far less costly than being rewound.
    if (local.positionSec === remote.positionSec) {
      return { winner: local.updatedAt >= remote.updatedAt ? local : remote, reason: 'more-recent' };
    }
    return {
      winner: local.positionSec > remote.positionSec ? local : remote,
      reason: 'further-position',
    };
  }

  return { winner: local.updatedAt > remote.updatedAt ? local : remote, reason: 'more-recent' };
}

/**
 * Where playback should actually start.
 *
 * Distinct from "the stored position" for two reasons that matter in practice:
 *
 *  - A **finished** episode restarts from zero. Resuming at 59:47 of a
 *    completed episode is never what anyone wants.
 *  - Resuming drops back a few seconds, because you lose the thread in the
 *    moment before you stopped. Every good podcast player does this and it is
 *    invisible until it is missing.
 */
export const RESUME_REWIND_SEC = 5;

/** Below this, a position is noise — treat it as never having started. */
const MIN_RESUMABLE_SEC = 10;

export function resumePosition(record: ProgressRecord | null): number {
  if (!record) return 0;
  if (record.completed) return 0;
  if (record.positionSec < MIN_RESUMABLE_SEC) return 0;

  if (record.durationSec !== null) {
    const remaining = record.durationSec - record.positionSec;
    // Effectively finished, even if never explicitly marked so.
    if (remaining <= COMPLETION_THRESHOLD_SEC) return 0;
  }

  return Math.max(0, record.positionSec - RESUME_REWIND_SEC);
}

/** Whether a position counts as having finished the episode. */
export function isComplete(positionSec: number, durationSec: number | null): boolean {
  if (durationSec === null || durationSec <= 0) return false;
  return durationSec - positionSec <= COMPLETION_THRESHOLD_SEC;
}
