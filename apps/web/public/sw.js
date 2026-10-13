/**
 * Cue's service worker.
 *
 * What this is for: opening the app with no connection and finding it there —
 * a neutral offline shell, your verified account's library, and artwork — instead of
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
const VERSION = 'v5';

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
let accountId = null;
let accountExpiresAt = 0;
let generation = 0;
let purging = Promise.resolve();
let privateCacheAvailable = true;

function cacheWork(work) {
  purging = purging.then(work).catch(() => {
    // A failed purge must never make old private entries readable again.
    privateCacheAvailable = false;
  });
  return purging;
}

function privateCache(name, owner) {
  return `${name}-account-${encodeURIComponent(owner)}`;
}

function resetAccount(next = null) {
  if (!next) accountExpiresAt = 0;
  if (next === accountId) return purging;
  const previous = accountId;
  accountId = next;
  generation += 1;
  cacheWork(async () => {
    if (previous) {
      await caches.delete(privateCache(DATA, previous));
      await caches.delete(privateCache(SHELL, previous));
    }
  });
  return purging;
}

async function invalidateSession() {
  await resetAccount();
  for (const client of await self.clients.matchAll()) client.postMessage({ type: 'session-invalid' });
}

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
    accountId = null;
    accountExpiresAt = 0;
    generation += 1;
    // Serialize deletion with writes, including responses already in flight.
    cacheWork(async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(DATA) || name.startsWith(`${SHELL}-account-`)).map((name) => caches.delete(name)));
    });
    event.waitUntil(purging);
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

  /**
   * Only our own images, which in practice is all of them.
   *
   * Artwork comes from whatever CDN each publisher uses, so the host list is
   * unbounded by nature — there is no `connect-src` that could name them, and
   * the only policy that would permit them is one broad enough (`https:`) to
   * stop being a policy. Next already solves this: `remotePatterns` in
   * next.config.ts lets it fetch each cover server-side and serve the optimised
   * copy from `/_next/image`, which is same-origin and cacheable here.
   *
   * A cross-origin cover therefore passes straight through to the browser,
   * which fetches it in the page's context and is not bound by the worker's
   * policy. Intercepting it only ever produced a refused fetch inside the
   * worker and a broken image on the page — strictly worse than not caching it.
   */
  if (request.destination === 'image') {
    if (url.origin === self.location.origin) {
      event.respondWith(cacheFirst(request, MEDIA, MEDIA_LIMIT));
    }
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
  if (API_ORIGIN && url.origin === API_ORIGIN && url.pathname === '/me') {
    event.respondWith(readSession(request));
    return;
  }

  if (API_ORIGIN && url.origin === API_ORIGIN) {
    if (url.pathname.startsWith('/me/')) {
      event.respondWith(privateData(request));
    } else if (/^\/categories$|^\/podcasts(?:\/(?:search|trending|[^/]+)(?:\/episodes)?)?$|^\/episodes\/[^/]+(?:\/tint)?$/.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(request, DATA, event));
    }
    // Transcripts, AI status, auth, and unknown endpoints always stay live.
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
 * Application documents contain account hydration and request-specific nonces.
 * Only the neutral offline document is safe to replay without a fresh session.
 */
async function handleNavigation(request) {
  try {
    // Even catalogue HTML carries account-specific hydration and a CSP nonce.
    // A navigation has no account-intent header; only the neutral offline page
    // can be safely replayed without establishing the current session.
    return await fetch(request);
  } catch {
    const offline = await caches.open(SHELL).then((cache) => cache.match(OFFLINE_URL)).catch(() => null);
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
  const cached = await caches.open(cacheName).then((cache) => cache.match(request)).catch(() => null);
  if (cached) return cached;

  const response = await fetch(request);

  // `response.ok` is false for an opaque cross-origin response, whose status is
  // always 0 — and publisher artwork is exactly that. Caching it is fine; the
  // browser simply will not let us read it.
  if (response.ok || response.type === 'opaque') {
    try {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
      if (limit) await trim(cacheName, limit);
    } catch {
      // Storage failure must not discard a usable network asset.
    }
  }

  return response;
}

async function readSession(request) {
  const admitted = generation;
  const response = await fetch(request);
  if (admitted !== generation) return response;
  if (response.ok) {
    const body = await response.clone().json().catch(() => null);
    if (admitted === generation) {
      const owner = body?.ok && typeof body.data?.user?.id === 'string' ? body.data.user.id : null;
      const expiry = typeof body?.data?.sessionExpiresAt === 'string' ? Date.parse(body.data.sessionExpiresAt) : NaN;
      // Older/malformed metadata cannot authorize an offline private read.
      accountExpiresAt = Number.isFinite(expiry) ? expiry : 0;
      await resetAccount(owner && accountExpiresAt > Date.now() ? owner : null);
    }
  } else if (response.status === 401) await invalidateSession();
  return response;
}

async function privateData(request) {
  await purging;
  if (accountId && accountExpiresAt <= Date.now()) await invalidateSession();
  const owner = accountId;
  const admitted = generation;
  // An older tab must not read the current tab's account cache while offline.
  const intendedOwner = request.headers.get('X-Cue-Account-Id');
  const canCache = privateCacheAvailable && owner && intendedOwner === owner;
  try {
    const response = await fetch(request);
    if (admitted !== generation) return response;
    if (response.status === 401 || (response.ok && owner && response.headers.get('X-Cue-Account-Id') !== owner)) {
      await invalidateSession();
      return response;
    }
    if (canCache && response.ok && response.status === 200) {
      cacheWork(async () => {
        if (admitted !== generation || accountExpiresAt <= Date.now()) return;
        const cache = await caches.open(privateCache(DATA, owner));
        if (admitted === generation && accountExpiresAt > Date.now()) await cache.put(request, response.clone());
      });
      await purging;
    }
    return response;
  } catch {
    if (canCache && privateCacheAvailable && admitted === generation && accountExpiresAt > Date.now()) {
      const cached = await caches.open(privateCache(DATA, owner))
        .then((cache) => cache.match(request)).catch(() => null);
      if (cached && privateCacheAvailable && admitted === generation && accountExpiresAt > Date.now()) return cached;
    }
    return offlineData();
  }
}

function offlineData() {
  return new Response(JSON.stringify({ ok: false, error: { code: 'upstream_unavailable', message: 'Offline' } }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Data: answer from cache immediately, refresh behind it.
 *
 * Only allowlisted public catalogue data uses this strategy. Private reads
 * verify the live session first and use their account cache only when offline.
 */
async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName).catch(() => null);
  const cached = cache ? await cache.match(request).catch(() => null) : null;

  const network = fetch(request)
    .then(async (response) => {
      // Only successful, complete responses. A 401 cached here would keep
      // answering "signed out" after someone signed in.
      if (cache && response.ok && response.status === 200) {
        await cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => undefined);
  event.waitUntil(network);

  if (cached) return cached;

  const response = await network;
  if (response) return response;

  // Nothing cached and nothing reachable. A JSON error the client can parse,
  // rather than a network failure it has to guess at.
  return offlineData();
}

/** Keep a cache under a ceiling, dropping what was added longest ago. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;

  // `keys()` is in insertion order, so the head is the oldest.
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
