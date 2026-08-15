import type { MetadataRoute } from 'next';

/**
 * The web app manifest.
 *
 * This is what lets someone install Cue to a home screen and open it without
 * browser chrome. Worth having for a media app specifically: a podcast is
 * something you start and then put the phone in your pocket, and a standalone
 * window keeps the lock-screen controls attached to an app rather than to "a
 * tab in Chrome".
 *
 * Generated rather than static so the colours come from the design tokens. A
 * hand-written `theme_color` is a hex literal that drifts the first time the
 * palette moves, and the symptom is a status bar that no longer matches the
 * page under it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cue — Podcasts',
    short_name: 'Cue',
    description: 'Follow shows, listen anywhere, and pick up where you left off.',
    start_url: '/',
    // `standalone` rather than `fullscreen`: this app has a system back
    // gesture's worth of navigation depth, and hiding the status bar on a
    // media app hides the clock and the battery someone is watching drain.
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#08080A',
    theme_color: '#08080A',
    categories: ['entertainment', 'music', 'news'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops icons to its own shape. Without a maskable variant it
      // crops the `any` one, and a rounded square inside a circle mask comes
      // out visibly clipped at the corners.
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'Library', url: '/library' },
      { name: 'Search', url: '/search' },
      { name: 'Queue', url: '/queue' },
    ],
  };
}
