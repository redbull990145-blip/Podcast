import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Podcast artwork comes from arbitrary third-party hosts (Libsyn, Megaphone,
    // Simplecast, self-hosted feeds...). We cannot enumerate them, so allow any
    // host but keep optimization on.
    //
    // http as well as https: plenty of long-running feeds still declare their
    // artwork over plain http (the BBC's ichef.bbci.co.uk among them), and
    // refusing those means a broken image rather than a secure one. Nothing
    // insecure reaches the browser — the optimizer fetches server-side and
    // re-serves the result over the page's own origin.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    // Publishers upload 3000x3000 cover art. Serving that untouched into a 44px
    // list thumbnail was the single biggest thing making the app feel slow, so
    // every artwork <Image> now goes through the optimizer with a real `sizes`.
    // Cover art effectively never changes, so cache the derivatives for a year:
    // that also keeps us well inside the free tier's transformation allowance,
    // since each (image, width) pair is only ever computed once.
    minimumCacheTTL: 31_536_000,
    // Trimmed from the default ladder — we only render artwork, and every
    // additional width is another transformation to pay for and cache.
    imageSizes: [32, 48, 64, 96, 128, 176, 256],
    deviceSizes: [640, 828, 1080],
  },
  experimental: {
    // Turns the barrel imports into direct ones. lucide-react alone is a few
    // thousand modules, which dev has to walk on every cold route compile.
    optimizePackageImports: ["lucide-react", "@tanstack/react-query", "dexie"],
  },
};

/**
 * Serwist builds the service worker through a webpack plugin, so production
 * builds run with `next build --webpack` (see package.json).
 *
 * Dev deliberately skips the wrapper entirely rather than relying on
 * Serwist's own `disable` option: @serwist/next always attaches a `webpack()`
 * function to the exported config, even when `disable: true` — the flag is
 * only checked inside that function at build time. Next 16 treats the mere
 * presence of a webpack config under Turbopack as fatal, before disable is
 * ever evaluated, so `next dev` (Turbopack) would refuse to start. Not
 * wrapping the config at all in dev avoids that, and is what we want anyway —
 * a service worker running in development caches aggressively enough to make
 * code changes look like they never applied.
 */
const isDev = process.env.NODE_ENV !== "production";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  reloadOnOnline: true,
});

export default isDev ? nextConfig : withSerwist(nextConfig);
