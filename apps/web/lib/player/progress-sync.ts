import { ApiClientError } from '@cue/api-client';
import { dropSent, queueProgress, type AccountSnapshot, type PendingProgress } from '@cue/core';
import { accountScope } from '../account';
import { api } from '../api';

// Session memory only: bounded and coalesced, with no private data in storage.
let held: PendingProgress[] = [];
let draining: AccountSnapshot | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let watching = false;

accountScope.subscribe(() => {
  held = [];
  draining = null;
  failures = 0;
  if (retry) clearTimeout(retry);
  retry = null;
});

export function holdWebProgress(entry: PendingProgress): void {
  if (!accountScope.snapshot().accountId) return;
  held = queueProgress(held, entry);
  if (!watching && typeof window !== 'undefined') {
    watching = true;
    window.addEventListener('online', () => { failures = 0; void flushWebProgress(); });
  }
  void flushWebProgress();
}

export async function flushWebProgress(): Promise<void> {
  const owner = accountScope.snapshot();
  if (draining || !owner.accountId || held.length === 0) return;
  if (retry) clearTimeout(retry);
  retry = null;
  draining = owner;
  try {
    while (accountScope.matches(owner) && held.length > 0) {
      const entry = held[0]!;
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 15_000);
      try {
        await api.reportProgress(entry.episodeId, {
          positionSec: Math.round(entry.positionSec), durationSec: entry.durationSec,
          completed: entry.completed, deviceId: entry.deviceId, observedAt: entry.observedAt,
        }, controller.signal);
      } catch (error) {
        if (!accountScope.matches(owner)) return;
        if (!(error instanceof ApiClientError) || error.retryable) {
          // Three automatic retries. A later observation or online event can
          // resume the retained entry without an unbounded retry loop.
          if (failures < 3) {
            failures += 1;
            retry = setTimeout(() => { retry = null; void flushWebProgress(); }, failures * 1000);
          }
          return;
        }
      } finally {
        clearTimeout(deadline);
      }
      if (!accountScope.matches(owner)) return;
      failures = 0;
      held = dropSent(held, [entry]);
    }
  } finally {
    if (draining === owner) draining = null;
  }
}
