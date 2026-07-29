"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, HardDrive, Loader2, Play, Trash2 } from "lucide-react";
import {
  formatBytes,
  isDownloadSupported,
  listDownloads,
  removeDownload,
  storageEstimate,
  type DownloadedEpisode,
} from "@/lib/offline/downloads";
import { useDownloadStatus } from "@/lib/offline/download-status";
import { usePlayer } from "@/lib/player/store";
import { EmptyState } from "@/components/ui/page";
import { formatDurationLong } from "@/lib/utils";

/**
 * Reads entirely from IndexedDB and Cache Storage, so this page works with no
 * connection — which is the only time it really matters.
 */
export function DownloadsList() {
  const [items, setItems] = useState<DownloadedEpisode[] | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const load = usePlayer((s) => s.load);

  const refresh = useCallback(async () => {
    setItems(await listDownloads());
    setStorage(await storageEstimate());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isDownloadSupported()) {
    return (
      <EmptyState
        Icon={HardDrive}
        title="Downloads aren't available here"
        description="This browser doesn't support the storage APIs downloads rely on. Everything else works normally."
      />
    );
  }

  if (items === null) {
    return (
      <div className="grid place-items-center py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        Icon={Download}
        title="Nothing downloaded"
        description="Downloaded episodes are kept in this browser's storage so they play with no connection at all."
      />
    );
  }

  const used = items.reduce((sum, d) => sum + d.bytes, 0);

  return (
    <div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            key={item.episodeId}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5"
          >
            <button
              onClick={() =>
                load({
                  id: item.episodeId,
                  title: item.title,
                  enclosureUrl: item.enclosureUrl,
                  durationSeconds: item.durationSeconds,
                  artworkUrl: item.artworkUrl,
                  podcastId: item.podcastId,
                  podcastTitle: item.podcastTitle,
                  categories: [],
                })
              }
              aria-label={`Play ${item.title}`}
              className="relative shrink-0"
            >
              {item.artworkUrl ? (
                <Image
                  src={item.artworkUrl}
                  alt=""
                  width={88}
                  height={88}
                  sizes="44px"
                  className="size-11 rounded-lg object-cover"
                />
              ) : (
                <span className="grid size-11 place-items-center rounded-lg bg-accent-subtle text-accent">
                  <Download className="size-4" />
                </span>
              )}
              <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                <Play className="size-4 fill-white text-white" />
              </span>
            </button>

            <div className="min-w-0 flex-1">
              <Link
                href={`/episode/${item.episodeId}`}
                className="block truncate text-sm font-medium hover:underline"
              >
                {item.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {item.podcastTitle}
                <span className="mx-1.5" aria-hidden>
                  ·
                </span>
                {formatBytes(item.bytes)}
                {item.durationSeconds ? (
                  <>
                    <span className="mx-1.5" aria-hidden>
                      ·
                    </span>
                    {formatDurationLong(item.durationSeconds)}
                  </>
                ) : null}
              </p>
            </div>

            <button
              onClick={async () => {
                // Keep the shared set in step, so a download button for this
                // episode elsewhere in the app flips back immediately.
                useDownloadStatus.getState().markRemoved(item.episodeId);
                await removeDownload(item.episodeId);
                void refresh();
              }}
              aria-label={`Delete download of ${item.title}`}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs text-subtle-foreground">
        {items.length} episode{items.length === 1 ? "" : "s"} using{" "}
        {formatBytes(used)} on this device
        {storage && storage.quota > 0 && (
          <> — the browser allows about {formatBytes(storage.quota)} in total</>
        )}
        .
      </p>
    </div>
  );
}
