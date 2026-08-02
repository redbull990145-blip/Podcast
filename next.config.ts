import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

/**
 * Baseline response hardening.
 *
 * Vercel supplies HSTS and nothing else, so before this the app shipped with no
 * clickjacking, sniffing or referrer protection at all.
 *
 * The CSP here is deliberately partial. `frame-ancestors`, `object-src`,
 * `base-uri` and `form-action` are the directives that need no cooperation from
 * the application — they close off framing, plugin embedding, `<base>` hijacking
 * and cross-origin form posts outright. `script-src` is absent on purpose:
 * Next.js inlines bootstrap scripts, so a real script policy needs per-request
 * nonces threaded through the document, and a half-written one would either
 * break the app or reduce to 'unsafe-inline' and protect nothing. `img-src` is
 * likewise absent because podcast artwork legitimately comes from any host.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // This app needs none of these; naming them denies them to any embedded
    // third-party content too.
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Removes "X-Powered-By: Next.js", which tells an attacker which framework
  // (and so which CVE list) to try without telling a user anything.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
    //
    // `motion` and `radix-ui` are here for the same reason and were the two
    // largest omissions: `motion` is imported by more files than anything else
    // in the app, and `radix-ui` is a single package re-exporting every
    // primitive, so an unoptimised import of one dialog pulls the whole set.
    optimizePackageImports: [
      "lucide-react",
      "@tanstack/react-query",
      "dexie",
      "motion",
      "radix-ui",
    ],
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
