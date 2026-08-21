import { join } from 'node:path';
import type { NextConfig } from 'next';

/**
 * The API's origin, for the service worker's CSP.
 *
 * Parsed rather than interpolated: a malformed value would otherwise be spliced
 * straight into a security header, and a CSP the browser cannot parse is one it
 * ignores. Returning null on anything unparseable keeps the policy strict —
 * `connect-src 'self'` — instead of accidentally permissive. Mirrors
 * `safeOrigin()` in components/pwa/service-worker.tsx, which resolves the same
 * value for the same worker from the other side.
 */
function apiOrigin(): string | null {
  const value = process.env['NEXT_PUBLIC_API_URL'];
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const config: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build step, so
  // Next compiles them alongside the app. That keeps edits to a shared token
  // or type instant instead of requiring a rebuild in another package.
  transpilePackages: ['@cue/api-client', '@cue/design', '@cue/motion', '@cue/types'],

  /**
   * Pin the root Next.js traces from, rather than let it infer one.
   *
   * Deploying with the API's `apps/api/tsconfig.json` header comment
   * documents two different ways a monorepo's implicit-resolution guess can
   * go wrong; this is a third. Without this set, Next looks for the nearest
   * lockfile to decide where the workspace root is, and on a platform build
   * that ships this app's source outside its own directory (Vercel's "include
   * files outside the Root Directory" — required here, since this app imports
   * `@cue/*` packages that live above it) that guess can land on the
   * monorepo root and trace sibling workspace packages into the serverless
   * function it should never have needed. `apps/api`'s `@cue/db` — a
   * Postgres/Drizzle package with no import anywhere in this app or its
   * dependencies — ended up bundled that way once, and Node's runtime cannot
   * execute the raw `.ts` source workspace packages ship, so the function
   * failed with `ERR_MODULE_NOT_FOUND` on every request rather than at build
   * time, when it would have been obvious. Pinning the root removes the
   * guess.
   */
  outputFileTracingRoot: join(import.meta.dirname, '../..'),

  images: {
    /**
     * Podcast artwork comes from whatever CDN each publisher uses, so the host
     * list is unbounded by nature. Next still optimises and resizes; it just
     * cannot allowlist hosts it has never heard of.
     *
     * On Cloudflare the optimiser behind `/_next/image` is not Next's own —
     * that one does not run under the Workers runtime at all. It is the
     * `IMAGES` binding declared in wrangler.jsonc, which the adapter
     * substitutes in. The substitution is behaviour-preserving in the two ways
     * that matter here: the fetch still happens on the server, and this list is
     * still enforced against the requested URL.
     *
     * Both halves are load-bearing, and the second is a security boundary
     * rather than a nicety — see the caveat at the end of this comment.
     *
     * `http` is listed as well as `https`, and it has to be: plenty of feeds
     * still advertise plain-http artwork — the BBC's `ichef.bbci.co.uk` among
     * them — and without this entry `next/image` throws an unconfigured-host
     * error that takes the whole route down. Search was crashing outright on
     * any result whose cover was http.
     *
     * This does not put insecure content on the page. The image is fetched
     * server-side and the optimised copy is served from our own origin over
     * https, so the browser never makes the plain-http request itself. This is
     * the guarantee that would be lost by switching to `unoptimized` or to a
     * client-side loader: the browser would request the plain-http URL
     * directly, the mixed-content rules would block it, and every show whose
     * publisher still advertises http artwork would render a broken image.
     *
     * The caveat, because `**` is doing something load-bearing and alarming:
     * this makes `/_next/image` an open image proxy. Anyone can hand it any URL
     * and get the response back from our domain. That is inherent to serving a
     * catalogue whose artwork hosts are not knowable in advance — the same was
     * true on Vercel — but it is worth knowing it is a deliberate trade rather
     * than an oversight, and worth revisiting if artwork ever moves into R2
     * under our own control, at which point this list becomes finite.
     *
     * It is also why the adapter version floor matters: `remotePatterns` was
     * not enforced by the Cloudflare adapter's image route before v1.3.0
     * (GHSA-rvpw-p7vw-wj3m), so on an older adapter this list would be decorative
     * and the proxy would be unbounded in ways even this comment does not cover.
     */
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
    /**
     * Artwork is square and displayed at a handful of fixed sizes.
     *
     * This list is also the cost dial for the `IMAGES` binding: Cloudflare
     * bills one "unique transformation" per source image *per size and format*,
     * with 5,000 free each month. Seven entries means one cover browsed at
     * every size can cost seven of them, so trimming this list is the first
     * lever to pull if the bill ever becomes real.
     */
    imageSizes: [48, 64, 96, 128, 192, 256, 384],

    /**
     * Ignored on Cloudflare — the Images binding does not implement it — and
     * kept for the Vercel build, which remains the rollback target. Cache
     * lifetime for optimised images there is Cloudflare's own, not this.
     */
    minimumCacheTTL: 60 * 60 * 24 * 7,
  },

  typedRoutes: true,

  /**
   * Rewrite barrel imports into direct module imports before bundling.
   *
   * `motion/react` re-exports its entire surface from one module, and the
   * bundler keeps the whole graph when any part of it is imported — so
   * `AnimatePresence` in the shell dragged in the projection engine behind
   * `Reorder`, on every route, despite nothing in the shell animating layout.
   * Measured at ~31KB gzipped of the app-shell route.
   */
  experimental: {
    optimizePackageImports: ['motion', '@tanstack/react-query'],
  },

  async headers() {
    const api = apiOrigin();

    return [
      {
        /**
         * The worker script must never be served from the HTTP cache.
         *
         * A browser will otherwise hold it for up to a day, which means a
         * caching policy — including a fix to one — takes a day to reach
         * anybody. `updateViaCache: 'none'` on the registration covers the
         * same ground from the other side; both are cheap and either alone is
         * a single point of failure for every cache bug that follows.
         */
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          /**
           * A worker has the run of the origin, so it stays as closed as it can
           * be: it loads no code from anywhere, and `script-src 'self'` says so.
           *
           * `connect-src` has to be stated separately, and this is the part that
           * is easy to get wrong. There is no `connect-src` here by default, so
           * fetches fall back to `default-src 'self'` — which reads as
           * reasonable and quietly forbids the one thing this worker exists to
           * do. Caching the library, the queue and search results means fetching
           * the API, and in this deployment the API is a different origin
           * (Vercel and Render are different registrable domains). So every one
           * of those fetches was refused before it left the browser and offline
           * support cached nothing, with the only symptom a CSP line in a
           * console nobody had open.
           *
           * Naming the API origin rather than relaxing the policy: this permits
           * exactly one host, and only for connections — not for scripts, which
           * stay `'self'` and are what a CSP is really guarding here.
           */
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self'",
              `connect-src 'self'${api ? ` ${api}` : ''}`,
            ].join('; '),
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here is meant to be embedded. `SAMEORIGIN` rather than
          // `DENY` so a future preview or dev tool can still frame it.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default config;
