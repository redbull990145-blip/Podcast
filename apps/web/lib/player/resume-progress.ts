import { reconcileProgress, type ProgressRecord } from '@cue/core';
import { accountScope } from '../account';
import { api } from '../api';

// A history request must not hold the audio request behind a slow API.
export const RESUME_LOOKUP_MS = 200;
const FRESH_MS = 30_000;
const cache = new Map<string, { record: ProgressRecord | null; at: number }>();
const pending = new Map<string, { promise: Promise<ProgressRecord | null>; cancel: () => void }>();

accountScope.subscribe(() => {
  for (const request of pending.values()) request.cancel();
  pending.clear();
  cache.clear();
});

export function rememberProgress(id: string, record: ProgressRecord): void {
  if (!accountScope.snapshot().accountId) return;
  // A local seek/restart wins over a request issued before that action.
  pending.get(id)?.cancel();
  cache.delete(id);
  cache.set(id, { record, at: Date.now() });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
}

export function knownResumeProgress(id: string, known: {
  positionSec: number; durationSec: number | null; completed?: boolean; updatedAt?: string | number;
} | null): ProgressRecord | null {
  if (!accountScope.snapshot().accountId) return null;
  const timestamp = typeof known?.updatedAt === 'string' ? Date.parse(known.updatedAt) : known?.updatedAt;
  const remote = known ? {
    positionSec: known.positionSec,
    durationSec: known.durationSec,
    completed: known.completed ?? false,
    deviceId: 'history',
    updatedAt: timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : 0,
  } : null;
  const local = cache.get(id)?.record ?? null;
  // A deliberate local rewind/restart must survive an older visible card.
  if (local && local.updatedAt >= (remote?.updatedAt ?? 0)) return local;
  return reconcileProgress(local, remote)?.winner ?? null;
}

export function readResumeProgress(id: string): Promise<ProgressRecord | null> {
  const owner = accountScope.snapshot();
  if (!owner.accountId) return Promise.resolve(null);
  const saved = cache.get(id);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve(saved?.record ?? null);
  }
  if (saved && Date.now() - saved.at < FRESH_MS) return Promise.resolve(saved.record);
  const existing = pending.get(id);
  if (existing) return existing.promise;

  const controller = new AbortController();
  let finish!: (record: ProgressRecord | null) => void;
  const promise = new Promise<ProgressRecord | null>((resolve) => { finish = resolve; });
  let settled = false;
  const complete = (record: ProgressRecord | null, received = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    pending.delete(id);
    if (received && accountScope.matches(owner)) {
      cache.set(id, { record, at: Date.now() });
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
    }
    finish(accountScope.matches(owner) ? record : null);
  };
  const cancel = () => {
    complete(saved?.record ?? null);
    controller.abort();
  };
  const deadline = setTimeout(cancel, RESUME_LOOKUP_MS);
  pending.set(id, { promise, cancel });
  void api.getProgress(id, { signal: controller.signal }).then(({ progress }) => {
    complete(progress ? {
      positionSec: progress.positionSec,
      durationSec: progress.durationSec,
      completed: progress.completed,
      deviceId: progress.deviceId,
      updatedAt: new Date(progress.updatedAt).getTime(),
    } : null, true);
  }).catch(() => complete(saved?.record ?? null));
  return promise;
}
