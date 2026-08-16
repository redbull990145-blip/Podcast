/**
 * Cue's service worker.
 *
 * What this is for: opening the app with no connection and finding it there —
 * the shell, the pages you have visited, your library, the artwork — instead of
 * the browser's dinosaur. Not written with a library, because the whole of it
 * is four routing decisions and a cache trim, and the smallest Workbox setup is
 * a build-step, a config, and a runtime to hold four routing decisions.
 *
 * The rule that matters most is the one about audio, below. Everything else
 * here degrades to "slower"; getting audio wrong degrades to "seeking is
 * broken", which is a bug people would blame on the player.
 *
 * Registered by components/pwa/service-worker.tsx, which passes the API origin
 * on the query string — a worker cannot read the app's environment, and the API
 * lives on a different host in every deployment.
 */

/**
 * Bump this to force every installed worker to be replaced.
 *
 * It names the caches below, so raising it drops the old ones on activate. But
 * the more important effect is the byte change itself: a browser decides
 * whether to install a new worker by comparing this script to the installed
 * copy, and an identical script is not an update no matter what else changed
 * around it.
 *
 * That matters because a worker's Content-Security-Policy is fixed at install
 * time, from the headers that delivered *this file*. Changing the CSP in
 * next.config.ts therefore does nothing on its own — the header on disk is
 * right, every already-installed worker keeps enforcing the old one, and the
 * two disagree indefinitely. v1 shipped without `connect-src`, so its fetches
 * to the API were refused by its own policy and every API read returned the
 * synthetic 503 below, which the app renders as "Offline" while the network is
 * perfectly fine.
 *
 * So: any change to the worker's CSP needs this bumped in the same commit.
 */
const VERSION = 'v2';

const SHELL = `cue-shell-${VERSION}`;
const STATIC = `cue-static-${VERSION}`;
const DATA = `cue-data-${VERSION}`;
const MEDIA = `cue-media-${VERSION}`;

const CACHES = [SHELL, STATIC, DATA, MEDIA];

/** The page shown when a route has never been visited and there is no network. */
const OFFLINE_URL = '/offline';

/**
 * How much artwork to keep.
 *
 * Covers are ~30–80KB each, so this is a few megabytes — enough for a library
 * and a few hundred rows of browsing, and nowhere near the point where a
 * browser starts evicting the whole origin.
 */
const MEDIA_LIMIT = 220;

/** Where the API lives, from the registration URL. Empty means "same origin". */
const API_ORIGIN = new URL(self.location.href).searchParams.get('api') ?? '';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // The one page that must exist before it is ever needed. Everything else
      // caches itself as it is visited.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache from an older version. Next fingerprints its assets,
      // so nothing here is worth carrying across a deploy.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('cue-') && !CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );

      await self.clients.claim();
    })(),
  );
});

/**
 * Sign-out has to empty the data cache.
 *
 * It holds responses to user-scoped endpoints — a library, a queue, listening
 * positions. Leaving them would show the next person to sign in on this browser
 * the previous person's shows until the first fetch replaced them.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'purge-data') {
    event.waitUntil(caches.delete(DATA));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GETs are cacheable, and a POST must never be replayed from a cache.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /**
   * Audio is never touched. Two independent reasons, either sufficient:
   *
   *  - Episodes are tens of megabytes and belong to publishers. Filling a
   *    browser's storage quota with them would evict everything else here.
   *  - Media elements request byte ranges. Answering a `Range` request with a
   *    whole cached body produces a 200 where the element expected a 206, and
   *    the symptom is a scrubber that cannot seek — a bug that looks like the
   *    player's fault and is impossible to find from there.
   */
  if (request.headers.has('range')) return;
  if (request.destination === 'audio' || request.destination === 'video') return;

  // Server-sent events — the streaming Ask answer — must stay a live socket.
  if (request.headers.get('accept')?.includes('text/event-stream')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    // Content-hashed: the URL changes when the bytes do, so this is safe
    // forever and never needs revalidating.
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, MEDIA, MEDIA_LIMIT));
    return;
  }

  if (request.destination === 'font') {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }

  /**
   * Never answer for the session endpoint.
   *
   * `/me` is "who am I", and every other answer to that is worse than waiting
   * for the real one: a cached copy signs a signed-out person back in, and the
   * synthetic 503 below reports a working network as offline. Both are states
   * the app acts on rather than displays, so getting them wrong does not look
   * like a caching bug — it looks like sign-in being broken, which is exactly
   * how the v1 CSP problem presented.
   *
   * Passing it through costs nothing offline: the request simply fails, which
   * is what "we do not know who you are" already means to every caller.
   */
  if (API_ORIGIN && url.origin === API_ORIGIN && url.pathname === '/me') return;

  if (API_ORIGIN && url.origin === API_ORIGIN) {
    event.respondWith(staleWhileRevalidate(request, DATA));
    return;
  }
});

/**
 * Navigations: network first.
 *
 * Freshness wins for a document, because it is what decides which JavaScript
 * the page then loads — serving a stale HTML shell that asks for assets a
 * deploy has removed is a white screen, which is worse than a slow one.
 *
 * The fallback chain is the point: this page from cache if it has been seen,
 * then the offline page. Falling straight to a generic offline page would throw
 * away a perfectly good copy of the very page someone asked for.
 */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(SHELL);
      await cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    // The offline page was evicted and there is no network to fetch it with.
    // A plain response beats a rejected promise, which the browser renders as
    // its own error page.
    return new Response('Offline', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  // `response.ok` is false for an opaque cross-origin response, whose status is
  // always 0 — and publisher artwork is exactly that. Caching it is fine; the
  // browser simply will not let us read it.
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    if (limit) await trim(cacheName, limit);
  }

  return response;
}

/**
 * Data: answer from cache immediately, refresh behind it.
 *
 * This is what makes the library render the moment the app opens rather than
 * after a round trip, and what makes it render at all on a train. The refresh
 * is fire-and-forget on purpose — waiting for it would give up the whole
 * benefit to guarantee freshness nobody asked for.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      // Only successful, complete responses. A 401 cached here would keep
      // answering "signed out" after someone signed in.
      if (response.ok && response.status === 200) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) return cached;

  const response = await network;
  if (response) return response;

  // Nothing cached and nothing reachable. A JSON error the client can parse,
  // rather than a network failure it has to guess at.
  return new Response(JSON.stringify({ error: { code: 'offline', message: 'Offline' } }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Keep a cache under a ceiling, dropping what was added longest ago. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;

  // `keys()` is in insertion order, so the head is the oldest.
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
