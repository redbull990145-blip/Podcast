'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the browser thinks it can reach the network.
 *
 * Be precise about what this is worth. `navigator.onLine` reports whether there
 * is *an* interface attached, not whether anything is reachable through it — it
 * says `true` behind a hotel captive portal and on a phone with a bar of signal
 * and no data. So this is used for one thing only: telling someone their
 * connection dropped, and pointing at what still works.
 *
 * Nothing depends on it for correctness. Requests are still attempted when it
 * says offline (`networkMode: 'always'` in the query client), because a request
 * that fails produces an error a person can act on, where one that is withheld
 * produces a spinner that never resolves.
 *
 * Next has an experimental `useOffline` that detects failures rather than
 * interfaces, and would be strictly better — but it only observes the
 * framework's own navigation and Server Action fetches, and every byte of data
 * in this app comes from a separate API through TanStack Query, which it does
 * not see. It buys nothing here that this does not, and costs an experimental
 * flag on a production deploy.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);

  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // On the server, and for the first paint before hydration. Rendering
    // "offline" and then correcting it would flash a warning at everybody.
    () => true,
  );
}

/**
 * Empty the cached API responses.
 *
 * Called on sign-out. The service worker holds answers to user-scoped
 * endpoints — a library, a queue, listening positions — and without this the
 * next person to sign in on this browser sees the previous person's shows until
 * each request is replaced.
 */
export function purgeCachedData(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: 'purge-data' });
}
