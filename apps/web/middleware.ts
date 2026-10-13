import { NextResponse, type NextRequest } from 'next/server';

/**
 * The Content-Security-Policy for every document this app serves.
 *
 * ON THE FILENAME, because `next build` prints a deprecation warning about it
 * on every single build and the obvious fix does not work here. Next 16 renamed
 * this convention to `proxy.ts`, and `proxy.ts` runs on the Node runtime —
 * which `@opennextjs/cloudflare` refuses outright: "Node.js middleware is not
 * currently supported. Consider switching to Edge Middleware." Nor can it be
 * asked to run on the edge; `export const config = { runtime: 'edge' }` fails
 * the build with "Proxy does not support Edge runtime". So the deprecated name
 * is the only one that deploys, because it is the only one that still compiles
 * to an edge function. Renaming this file — or running the codemod the warning
 * suggests — breaks `opennextjs-cloudflare build`, not at runtime but with a
 * hard build error, and takes the whole policy below with it. Revisit when the
 * adapter supports Node middleware; until then the warning is the cost.
 *
 * The `/sw.js` policy in next.config.ts covers the worker script and is a
 * different, much tighter thing; this one covers pages. It has to live here
 * rather than beside that one because the interesting half of it is a
 * per-request nonce, and `headers()` in next.config.ts is static — evaluated
 * once at build, identical on every response. A nonce that never changes is
 * not a nonce.
 *
 * What this actually buys, since a CSP full of `https:` sources can look
 * decorative: `script-src` is the directive that matters, and it is closed.
 * Naming a nonce there makes the browser ignore `'unsafe-inline'`, so an
 * injected `<script>` — or an `onclick=` written into the DOM — does not run,
 * even though the app's own two inline scripts in app/layout.tsx do. Show
 * notes are publisher HTML rendered through `dangerouslySetInnerHTML`
 * (sanitised at ingest in apps/api/src/feed/sanitize.ts); this is the second
 * lock on that door, for the day the first one has a bug.
 *
 * The permissive directives are permissive on purpose, and each for a reason
 * that cannot be designed away:
 *
 * - `img-src`/`media-src` allow any https host because artwork and audio come
 *   from whatever CDN each publisher uses. That set is unbounded by nature —
 *   the same reason `images.remotePatterns` is `**`. This still forbids those
 *   hosts from being script sources, which is the part that matters: a hostile
 *   artwork host can serve a bad picture, not code on our origin.
 * - `style-src` needs `'unsafe-inline'` and must NOT carry a nonce. Motion
 *   animates by writing inline `style` attributes on every frame, and a nonce
 *   in this directive would make the browser ignore `'unsafe-inline'` and
 *   freeze every animation in the app.
 *
 * `base-uri 'none'` is the quiet one worth keeping: without it, an injected
 * `<base href>` rewrites every relative script URL on the page, which turns a
 * markup-injection bug back into script execution regardless of `script-src`.
 */
function policy(nonce: string): string {
  const api = apiOrigin();
  const dev = process.env.NODE_ENV === 'development';

  return [
    "default-src 'self'",
    // `'unsafe-eval'` in development only: the dev server's hot reload compiles
    // modules with eval, and without it the app will not boot under `next dev`.
    // It is never sent from a production build.
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // next/font self-hosts Geist at build time, so no font CDN is needed here.
    "font-src 'self' data:",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' blob: https: http:",
    `connect-src 'self'${api ? ` ${api}` : ''}${dev ? ' ws: http://localhost:*' : ''}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Nothing is embedded and nothing embeds us. `frame-ancestors` is the
    // modern half of the X-Frame-Options header next.config.ts still sends for
    // the browsers that only read that one.
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * The API's origin, for `connect-src`.
 *
 * Parsed rather than interpolated, for the reason the identically-named
 * function in next.config.ts documents: a malformed value spliced into a
 * header yields a policy the browser cannot parse, and an unparseable CSP is
 * an absent one.
 *
 * The `localhost:8080` fallback is not a nicety — it has to match the fallback
 * in lib/api.ts and lib/player/store.ts exactly, because those two decide the
 * URL the browser actually requests. If this function returned null where they
 * fall back, an unset `NEXT_PUBLIC_API_URL` would leave `connect-src 'self'`
 * refusing every call the app then went ahead and made, and the whole app would
 * fail with nothing but a CSP line in the console to say why. The policy has to
 * describe what the app is configured to do, not what it ought to be configured
 * to do. Change the fallback in either of those files and change it here.
 */
const API_FALLBACK = 'http://localhost:8080';

function apiOrigin(): string | null {
  try {
    return new URL(process.env['NEXT_PUBLIC_API_URL'] || API_FALLBACK).origin;
  } catch {
    // A malformed configured value. Fall back rather than emit a broken policy
    // — but only to the same default the clients use, never to something wider.
    try {
      return new URL(API_FALLBACK).origin;
    } catch {
      return null;
    }
  }
}

export function middleware(request: NextRequest) {
  // 16 bytes, base64. The Workers and Node runtimes both expose Web Crypto as
  // a global, so this needs no import and no Node built-in.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));

  /*
    The nonce travels to the render on a request header rather than a module
    variable or an async-local store, because that is the channel Next itself
    reads: given the request CSP, it stamps every script tag it generates — the
    bootstrap, the chunk tags, the flight-data pushes — with the same value.
    Without it those tags would be nonce-less and a `script-src` this strict
    would refuse to run the app at all. app/layout.tsx reads the same header
    for its two hand-written inline scripts.
  */
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  const contentSecurityPolicy = policy(nonce);
  headers.set('Content-Security-Policy', contentSecurityPolicy);
  headers.delete('Content-Security-Policy-Report-Only');

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    /*
      Documents only.

      Static chunks and optimised images are not documents and a CSP on them
      does nothing; running this over them would just add a hop to every
      asset. `sw.js` is excluded deliberately rather than incidentally — it
      carries its own, stricter policy from next.config.ts, and a second CSP
      header does not replace the first, it intersects with it. Sending both
      would enforce the union of their restrictions and break the worker.
    */
    '/((?!_next/static|_next/image|sw\\.js|icon\\.svg|apple-icon\\.png|manifest\\.webmanifest|favicon\\.ico).*)',
  ],
};
