import { queryKeys } from '@cue/api-client';
import type { QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { isOnline, subscribeConnectivity } from './connectivity';
import { flushProgress } from './sync/outbox';
import { requireSessionRevalidation } from './auth-token';

const watched = new WeakMap<QueryClient, { refs: number; stop: () => void }>();
/** One native lifecycle subscription per cache, shared by session consumers. */
export function watchSessionLifecycle(client: QueryClient): () => void {
  let record = watched.get(client);
  if (!record) {
    const refresh = () => {
      requireSessionRevalidation();
      if (!isOnline()) return;
      void client.invalidateQueries({ queryKey: queryKeys.session }).then(() => flushProgress()).catch(() => undefined);
    };
    const state = AppState.addEventListener('change', (next) => { if (next === 'active') refresh(); });
    const unsubscribe = subscribeConnectivity(refresh);
    record = { refs: 0, stop: () => { state.remove(); unsubscribe(); } };
    watched.set(client, record);
  }
  record.refs += 1;
  let released = false;
  return () => {
    if (released || !record || record.refs === 0) return;
    released = true;
    record.refs -= 1;
    if (record.refs === 0) { record.stop(); watched.delete(client); }
  };
}
