import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { accountScope, bindAccountCache } from './account';

describe('private query cache transitions', () => {
  it('clears both active UI data and inactive cache entries on account change', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    accountScope.set('A'); bindAccountCache(client);
    client.setQueryData(['queue'], { items: ['A-private'] });
    client.setQueryData(['library'], { items: ['A-library'] });
    const observer = new QueryObserver(client, { queryKey: ['queue'], enabled: false });
    const unsubscribe = observer.subscribe(() => undefined);
    accountScope.set('B');
    expect(client.getQueryData(['library'])).toBeUndefined();
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe(); client.clear();
  });
});
