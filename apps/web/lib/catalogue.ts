import 'server-only';
import { createClient } from '@cue/api-client';

const baseUrl =
  process.env['NEXT_PUBLIC_API_URL']?.replace(/\/$/, '') ?? 'http://localhost:8080';

/**
 * How long a catalogue read stays fresh in Next's Data Cache.
 *
 * Matches the `revalidate` the three catalogue pages used to declare as a route
 * segment config. That declaration never did anything — see the comment on
 * `catalogue` below — so the number moved here, where it does.
 */
const CATALOGUE_REVALIDATE_SEC = 300;

/** Server-only; see the header note in `catalogue` below for why it is not NEXT_PUBLIC_. */
const internalToken = process.env['INTERNAL_API_TOKEN'];

/**
 * A second client whose GETs are cached, for public catalogue data only.
 *
 * **Why this exists.** `app/(app)/page.tsx`, `podcast/[id]` and `episode/[id]`
 * each declared `export const revalidate = 300`, intending to serve a cached
 * page and refresh it in the background. None of them ever did. Route-level
 * caching requires a statically renderable route, and every route here is
 * dynamic for a reason that cannot be removed: `app/layout.tsx` reads the CSP
 * nonce off a request header, and a nonce that survives into a cached page is
 * not a nonce. (`resolveLocale()` reading cookies is a second, smaller reason.)
 * So the pages re-rendered from scratch on every request, blocking on a live
 * API call each time — measured at ~470ms of an ~888ms TTFB with the API on
 * localhost, and the API is not on localhost in production.
 *
 * The Data Cache is the layer that still works when the route cache cannot:
 * it is keyed on the request, not the render, so a dynamic page can still get
 * a cached body back. The revalidation intent survives; only the layer changes.
 *
 * **The rule, and it is not a style preference.** This client is for anonymous,
 * public catalogue reads and nothing else. The Data Cache is keyed on URL and
 * fetch options — *not* on the caller's identity — so caching a per-listener
 * response here would serve one person's library, queue or playlists to the
 * next person who asked. Library, queue, playlists, progress, history, AI and
 * anything else scoped to a session stay on `api` in lib/api.ts, uncached.
 *
 * `credentials: 'omit'` enforces that rather than trusting the rule to be
 * remembered. Server-side `fetch` has no cookie jar today, so the client's
 * `credentials: 'include'` is already inert here — but "already inert" is a
 * property of the current code, not a guarantee, and the day someone forwards
 * the incoming cookie to make an authenticated server render work, this line is
 * what stops that request from being cached under a key that ignores who sent
 * it. Overriding it costs nothing and closes the hole in advance.
 */
export const catalogue = createClient({
  baseUrl,
  fetchImpl: (input, init) =>
    fetch(input, {
      ...init,
      credentials: 'omit',
      /**
       * Identifies these calls as our own renderer, not a client.
       *
       * The API rate limits catalogue reads per caller, and a caller is
       * identified by IP when there is no session. Server components run on a
       * Cloudflare Worker, so without this every server-rendered page view in
       * the world would share one IP-keyed budget and the front page would
       * start being refused under load. See INTERNAL_API_TOKEN in
       * apps/api/src/config.ts.
       *
       * The server-only import rejects accidental use in a Client Component.
       * Keep this private token out of lib/api.ts and never give it a
       * NEXT_PUBLIC_ name, which would inline its value into browser JavaScript.
       *
       * Unset on the API means unlimited, not blocked — the API skips the
       * limit entirely when it has no token to compare against.
       */
      ...(internalToken ? { headers: { ...init?.headers, 'x-cue-internal': internalToken } } : {}),
      next: { revalidate: CATALOGUE_REVALIDATE_SEC },
    }),
});
