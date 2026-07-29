"use client";

import Dexie, { type EntityTable } from "dexie";

/**
 * Offline downloads.
 *
 * Storage is split deliberately:
 *  - Cache Storage holds the audio bytes. It is the only store the service
 *    worker can serve responses from directly, and it handles large binaries
 *    without the overhead of reading a blob out of IndexedDB first.
 *  - IndexedDB (via Dexie) holds the metadata needed to render the Downloads
 *    page while offline, when no server query is possible.
 *
 * Nothing is uploaded. Downloads live on the device that made them, which is
 * why the server only ever tracks that one exists.
 */

/** Must match DOWNLOAD_CACHE in app/sw.ts. */
const DOWNLOAD_CACHE = "cadence-episode-audio-v1";

export type DownloadedEpisode = {
  episodeId: string;
  enclosureUrl: string;
  title: string;
  podcastId: string;
  podcastTitle: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  bytes: number;
  downloadedAt: number;
};

const database = new Dexie("cadence-offline") as Dexie & {
  downloads: EntityTable<DownloadedEpisode, "episodeId">;
};

database.version(1).stores({
  downloads: "episodeId, podcastId, downloadedAt",
});

export const offlineDb = database;

export function isDownloadSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

/**
 * Streams an episode into Cache Storage, reporting progress as it goes.
 *
 * Uses a manual stream rather than `cache.add()` so there is a real progress
 * bar — downloading a two-hour episode on a phone connection is not something
 * to hide behind a spinner.
 */
export async function downloadEpisode(
  episode: Omit<DownloadedEpisode, "bytes" | "downloadedAt">,
  onProgress?: (received: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  if (!isDownloadSupported()) {
    return { ok: false, error: "This browser can't store downloads." };
  }

  try {
    const response = await fetch(episode.enclosureUrl, {
      signal,
      // Podcast hosts rarely send permissive CORS. An opaque response cannot be
      // read by script, but the service worker can still replay it to the audio
      // element, which is all a download needs to do.
      mode: "no-cors",
    });

    // An opaque response has no readable body, so progress reporting is only
    // possible when the host does send CORS headers. Fall back to storing it
    // wholesale in that case.
    if (response.type === "opaque" || !response.body) {
      const cache = await caches.open(DOWNLOAD_CACHE);
      await cache.put(episode.enclosureUrl, response.clone());
      const bytes = Number(response.headers.get("content-length") ?? 0);
      await offlineDb.downloads.put({
        ...episode,
        bytes,
        downloadedAt: Date.now(),
      });
      onProgress?.(bytes, bytes || null);
      return { ok: true, bytes };
    }

    const total = Number(response.headers.get("content-length")) || null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(received, total);
    }

    const blob = new Blob(chunks as BlobPart[], {
      type: response.headers.get("content-type") ?? "audio/mpeg",
    });

    const cache = await caches.open(DOWNLOAD_CACHE);
    await cache.put(
      episode.enclosureUrl,
      new Response(blob, {
        headers: {
          "content-type": blob.type,
          "content-length": String(blob.size),
        },
      }),
    );

    await offlineDb.downloads.put({
      ...episode,
      bytes: blob.size,
      downloadedAt: Date.now(),
    });

    return { ok: true, bytes: blob.size };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Download cancelled." };
    }
    // The most common real failure is the origin's storage quota being full.
    if (err instanceof Error && err.name === "QuotaExceededError") {
      return {
        ok: false,
        error: "Not enough storage space. Remove some downloads and try again.",
      };
    }
    return { ok: false, error: "Couldn't download that episode." };
  }
}

export async function removeDownload(episodeId: string): Promise<void> {
  const record = await offlineDb.downloads.get(episodeId);
  if (record) {
    const cache = await caches.open(DOWNLOAD_CACHE);
    await cache.delete(record.enclosureUrl);
  }
  await offlineDb.downloads.delete(episodeId);
}

export async function listDownloads(): Promise<DownloadedEpisode[]> {
  if (!isDownloadSupported()) return [];
  return offlineDb.downloads.orderBy("downloadedAt").reverse().toArray();
}

export async function isDownloaded(episodeId: string): Promise<boolean> {
  if (!isDownloadSupported()) return false;
  return (await offlineDb.downloads.get(episodeId)) != null;
}

/** Total bytes stored, for the Downloads page footer. */
export async function totalDownloadedBytes(): Promise<number> {
  const all = await listDownloads();
  return all.reduce((sum, d) => sum + d.bytes, 0);
}

/** How much room the browser will actually give us, when it will say. */
export async function storageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
