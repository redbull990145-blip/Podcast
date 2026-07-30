/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Must match DOWNLOAD_CACHE in lib/offline/downloads.ts. */
const DOWNLOAD_CACHE = "cadence-episode-audio-v1";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        // Without this, navigating offline to a page that was never visited
        // shows the browser's own error page rather than anything of ours.
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

/**
 * Serves downloaded episodes from Cache Storage.
 *
 * This runs before Serwist's own routing so a downloaded episode plays with no
 * connection at all. Audio is stored as an opaque response (podcast hosts do
 * not send permissive CORS for range requests), which a normal fetch would not
 * be able to read — but the service worker can hand it straight back to the
 * media element.
 */
self.addEventListener("fetch", (event: FetchEvent) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const destination = request.destination;
  if (destination !== "audio" && destination !== "video") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(DOWNLOAD_CACHE);
      // ignoreVary and ignoreSearch: media elements issue range requests and
      // append cache-busting params, neither of which should miss a download
      // we already have in full.
      const cached = await cache.match(request, {
        ignoreVary: true,
        ignoreSearch: false,
      });
      if (cached) return cached;

      try {
        return await fetch(request);
      } catch {
        return new Response("Offline and this episode is not downloaded.", {
          status: 504,
          statusText: "Offline",
        });
      }
    })(),
  );
});

serwist.addEventListeners();
