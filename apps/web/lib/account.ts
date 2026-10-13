import { AccountScope } from '@cue/core';
import type { QueryClient } from '@tanstack/react-query';
import { purgeCachedData } from './connectivity';

export const accountScope = new AccountScope();
const bound = new WeakSet<QueryClient>();

export function bindAccountCache(client: QueryClient): void {
  if (bound.has(client)) return;
  bound.add(client);
  accountScope.subscribe(() => {
    const filter = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== 'session' };
    void client.cancelQueries(filter);
    void client.resetQueries(filter).catch(() => undefined);
    client.removeQueries({ ...filter, type: 'inactive' });
    client.getMutationCache().clear();
    if (!accountScope.snapshot().accountId) client.setQueryData(['session'], { user: null });
  });
  if (typeof window !== 'undefined') {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('cue-account');
    const reset = () => {
      accountScope.set(null, true);
      client.setQueryData(['session'], { user: null });
      void client.invalidateQueries({ queryKey: ['session'] });
    };
    if (channel) channel.onmessage = reset;
    navigator.serviceWorker?.addEventListener('message', (event) => {
      if (event.data?.type === 'session-invalid') reset();
    });
  }
}

export function beginAccountTransition(client: QueryClient): void {
  bindAccountCache(client);
  void client.cancelQueries({ queryKey: ['session'] });
  accountScope.set(null, true);
  client.setQueryData(['session'], { user: null });
  purgeCachedData();
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('cue-account');
    channel.postMessage('reset');
    channel.close();
  }
}
