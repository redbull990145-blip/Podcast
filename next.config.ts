import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Podcast artwork comes from arbitrary third-party hosts (Libsyn, Megaphone,
    // Simplecast, self-hosted feeds...). We cannot enumerate them, so allow any
    // https host but keep optimization on.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

/**
 * Serwist builds the service worker through a webpack plugin, so production
 * builds run with `next build --webpack` (see package.json). Dev stays on
 * Turbopack, which is fine because the service worker is disabled there — one
 * left running in development caches aggressively enough to make code changes
 * look like they never applied.
 */
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: true,
});

export default withSerwist(nextConfig);
