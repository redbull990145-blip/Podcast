import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build step, so
  // Next compiles them alongside the app. That keeps edits to a shared token
  // or type instant instead of requiring a rebuild in another package.
  transpilePackages: ['@cue/api-client', '@cue/design', '@cue/motion', '@cue/types'],

  images: {
    // Podcast artwork comes from whatever CDN each publisher uses, so the host
    // list is unbounded by nature. Next still optimises and resizes; it just
    // cannot allowlist hosts it has never heard of.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
    // Artwork is square and displayed at a handful of fixed sizes.
    imageSizes: [48, 64, 96, 128, 192, 256, 384],
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
          // A worker has the run of the origin, so it is worth being explicit
          // that this one loads nothing from anywhere else.
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
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
