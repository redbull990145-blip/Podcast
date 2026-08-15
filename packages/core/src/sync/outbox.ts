/**
 * Progress that could not be sent yet.
 *
 * Without this, offline listening is quietly worth nothing. Position writes go
 * out every fifteen seconds and on every pause; with no connection each one
 * fails, is swallowed, and is never spoken of again — so an hour of listening
 * on a plane lands with the episode exactly where it was at the gate. That is
 * the most annoying possible outcome, because everything *appeared* to work.
 *
 * Three properties make this an outbox rather than a log:
 *
 *  1. **Coalesced by episode.** Only the latest position for an episode
 *     matters. Keeping every fifteen-second sample would mean replaying a
 *     thousand writes on reconnect to arrive at a number we already had.
 *  2. **Carries when it was observed, not when it was sent.** The server
 *     reconciles by comparing timestamps against other devices, and stamping
 *     these at send time would make an hour-old position look like the newest
 *     thing anyone had reported — rewinding a device that was genuinely ahead.
 *  3. **Bounded.** Storage that only grows is a bug with a long fuse. Oldest
 *     observations are dropped first, so the cap costs the least useful
 *     entries.
 */

export type PendingProgress = {
  episodeId: string;
  positionSec: number;
  durationSec: number | null;
  completed: boolean;
  deviceId: string;
  /** Epoch ms at which playback was here. Not when the write was attempted. */
  observedAt: number;
};

/**
 * More than anyone accumulates in a realistic offline session — a listener
 * would have to start two hundred distinct episodes without connectivity — and
 * small enough that the file stays trivial to read and write.
 */
export const OUTBOX_LIMIT = 200;

/**
 * Add a position, replacing whatever was held for that episode.
 *
 * An older observation never overwrites a newer one. That sounds impossible
 * until a flush fails halfway and its entries are re-queued behind writes that
 * happened while it was in flight, at which point it is the normal case.
 */
export function queueProgress(
  outbox: readonly PendingProgress[],
  entry: PendingProgress,
  limit: number = OUTBOX_LIMIT,
): PendingProgress[] {
  const existing = outbox.find((item) => item.episodeId === entry.episodeId);
  if (existing && existing.observedAt >= entry.observedAt) return [...outbox];

  const without = outbox.filter((item) => item.episodeId !== entry.episodeId);
  const next = [...without, entry];

  // Oldest first, so the tail is what gets cut.
  if (next.length <= limit) return next;

  return [...next].sort((a, b) => a.observedAt - b.observedAt).slice(next.length - limit);
}

/**
 * Remove what was successfully sent.
 *
 * Matched on `observedAt` rather than on episode id, because playback does not
 * stop while a flush is in progress: by the time the server answers, the same
 * episode may already hold a newer position, and clearing by id would throw
 * away the only record of it.
 */
export function dropSent(
  outbox: readonly PendingProgress[],
  sent: readonly PendingProgress[],
): PendingProgress[] {
  const sentAt = new Map(sent.map((item) => [item.episodeId, item.observedAt]));

  return outbox.filter((item) => {
    const delivered = sentAt.get(item.episodeId);
    return delivered === undefined || item.observedAt > delivered;
  });
}

/**
 * Drop anything written by a different account.
 *
 * Signing out has to clear the outbox, or the next person to sign in on this
 * handset silently inherits someone else's listening positions the moment the
 * connection returns. Signing out is not a reason to sync harder.
 */
export function clearOutbox(): PendingProgress[] {
  return [];
}

/**
 * Coerce whatever was on disk back into entries.
 *
 * The file was written by a previous version of this app and lives somewhere
 * the user could in principle edit, so every field is checked rather than
 * trusted. One malformed entry is skipped; it must not take the rest of
 * someone's offline session with it.
 */
export function normalizeOutbox(input: unknown): PendingProgress[] {
  if (!Array.isArray(input)) return [];

  const entries: PendingProgress[] = [];

  for (const candidate of input) {
    if (typeof candidate !== 'object' || candidate === null) continue;

    const item = candidate as Partial<Record<keyof PendingProgress, unknown>>;
    if (typeof item.episodeId !== 'string' || item.episodeId.length === 0) continue;
    if (typeof item.positionSec !== 'number' || !Number.isFinite(item.positionSec)) continue;
    if (typeof item.observedAt !== 'number' || !Number.isFinite(item.observedAt)) continue;
    if (typeof item.deviceId !== 'string') continue;

    entries.push({
      episodeId: item.episodeId,
      positionSec: item.positionSec,
      durationSec:
        typeof item.durationSec === 'number' && Number.isFinite(item.durationSec)
          ? item.durationSec
          : null,
      completed: item.completed === true,
      deviceId: item.deviceId,
      observedAt: item.observedAt,
    });
  }

  return entries;
}
