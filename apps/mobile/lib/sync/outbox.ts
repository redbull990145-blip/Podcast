import { ApiClientError } from '@cue/api-client';
import { dropSent, normalizeOutbox, queueProgress, type PendingProgress } from '@cue/core';
import { File, Paths } from 'expo-file-system';
import { api } from '@/lib/api';
import { isOnline, subscribeConnectivity } from '@/lib/connectivity';

/**
 * Listening positions that could not be sent.
 *
 * This is what makes offline listening count for anything. Progress writes go
 * out every fifteen seconds and on every pause; with no connection each one
 * fails, and without somewhere to put it, an hour of listening on a plane ends
 * with the episode exactly where it was at the gate — while everything on
 * screen looked like it was working.
 *
 * The queue itself, its coalescing and its bound are in `@cue/core` and tested
 * there. What is here is the two things that need a device: a file to survive a
 * restart, and a connection to drain into.
 */

const FILE = new File(Paths.document, 'progress-outbox.json');

let outbox: PendingProgress[] | null = null;
let flushing = false;
let watching = false;

function load(): PendingProgress[] {
  if (outbox) return outbox;

  try {
    outbox = FILE.exists ? normalizeOutbox(JSON.parse(FILE.textSync())) : [];
  } catch {
    // Unreadable or truncated. Starting empty loses positions that were already
    // lost; crashing on launch would lose the app.
    outbox = [];
  }

  return outbox;
}

function persist(): void {
  try {
    FILE.write(JSON.stringify(outbox ?? []));
  } catch {
    // Survives this session but not a restart. Not worth interrupting anyone.
  }
}

/**
 * Watch for the connection coming back.
 *
 * Started lazily, on the first held write, so a listener who is never offline
 * never registers a listener for it.
 */
function watch(): void {
  if (watching) return;
  watching = true;

  subscribeConnectivity(() => {
    if (isOnline()) void flushProgress();
  });
}

/** Hold a position until there is somewhere to send it. */
export function holdProgress(entry: PendingProgress): void {
  outbox = queueProgress(load(), entry);
  persist();
  watch();
}

/**
 * Send everything held, oldest observation first.
 *
 * Two rules make this drain rather than stall.
 *
 * A **permanent** rejection retires the entry. An episode the server has never
 * heard of, or that this account may no longer read, will answer the same way
 * forever — and one such entry at the head of the queue would block every
 * position behind it for the life of the install.
 *
 * A **transient** failure stops the run and keeps the rest. Still offline, or a
 * server having a bad minute: there is nothing to learn by hammering the
 * remaining entries, and the next reconnect tries again.
 *
 * What was delivered is cleared by observation time rather than by episode,
 * because playback does not stop while this is in flight — by the time the
 * server answers, the same episode may already hold a newer position.
 */
export async function flushProgress(): Promise<void> {
  if (flushing) return;

  const held = load();
  if (held.length === 0) return;

  flushing = true;

  const settled: PendingProgress[] = [];

  try {
    for (const entry of [...held].sort((a, b) => a.observedAt - b.observedAt)) {
      try {
        await api.reportProgress(entry.episodeId, {
          positionSec: Math.round(entry.positionSec),
          durationSec: entry.durationSec,
          completed: entry.completed,
          deviceId: entry.deviceId,
          observedAt: entry.observedAt,
        });

        settled.push(entry);
      } catch (error) {
        if (isPermanent(error)) {
          settled.push(entry);
          continue;
        }
        break;
      }
    }
  } finally {
    if (settled.length > 0) {
      outbox = dropSent(outbox ?? [], settled);
      persist();
    }
    flushing = false;
  }
}

/**
 * Whether re-sending could ever work.
 *
 * A dropped connection is transient by definition; a 4xx that is not rate
 * limiting is the server saying no rather than not now. Anything unrecognised
 * is treated as transient, which errs towards keeping a listening position we
 * are unsure about rather than discarding it.
 */
function isPermanent(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  return error.status >= 400 && error.status < 500 && !error.retryable;
}

/**
 * Forget everything held.
 *
 * Signing out has to clear this, or the next person to sign in on the handset
 * silently inherits someone else's listening positions the moment the
 * connection returns.
 */
export function clearHeldProgress(): void {
  outbox = [];
  persist();
}

/** How many positions are waiting. Drives the "will sync later" line. */
export function heldProgressCount(): number {
  return load().length;
}
