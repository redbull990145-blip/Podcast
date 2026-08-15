'use client';

import { useEffect } from 'react';

/**
 * Register the service worker.
 *
 * Rendered once, in the app shell. Nothing is rendered — this exists purely for
 * the effect, and putting it in the shell rather than the root layout keeps it
 * off the auth pages, where there is nothing worth caching and a worker
 * claiming the page mid-sign-in is a complication for no gain.
 *
 * The API origin travels on the query string because a worker runs outside the
 * bundle and cannot read `process.env`. Changing it changes the worker's URL,
 * which is correct: pointing the app at a different API *should* install a
 * different worker rather than leaving one that caches the old host.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Registering in dev would cache a development build's assets and then
    // serve them over the next `next dev` run — a stale-asset bug that looks
    // like a compiler failure and survives a hard refresh.
    if (process.env.NODE_ENV !== 'production') return;

    const api = process.env['NEXT_PUBLIC_API_URL'];
    const origin = api ? safeOrigin(api) : '';
    const url = origin ? `/sw.js?api=${encodeURIComponent(origin)}` : '/sw.js';

    void navigator.serviceWorker
      .register(url, {
        scope: '/',
        // Never satisfy the worker script itself from the HTTP cache. Without
        // this a browser may hold a worker for up to a day and quietly keep
        // serving a caching policy that has since been replaced.
        updateViaCache: 'none',
      })
      .catch(() => {
        // A blocked or unsupported worker costs the offline shell and nothing
        // else. The app works; it just stops working without a connection.
      });
  }, []);

  return null;
}

/** An origin, or nothing — a malformed env var must not break registration. */
function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}
