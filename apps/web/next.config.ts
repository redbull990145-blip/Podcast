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
};

export default config;
