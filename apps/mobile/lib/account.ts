import { AccountScope } from '@cue/core';
import type { QueryClient } from '@tanstack/react-query';

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
}
