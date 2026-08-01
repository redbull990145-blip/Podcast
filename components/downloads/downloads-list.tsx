"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
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
import { press } from "@/lib/motion/gestures";
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
      <StorageMeter episodes={used} storage={storage} count={items.length} />

      <ul className="mt-5.5">
        {items.map((item) => (
          <li
            key={item.episodeId}
            className="flex items-center gap-3.5 border-b border-border-4 px-1 py-4 last:border-0"
          >
            <motion.button
              {...press}
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
                  width={92}
                  height={92}
                  sizes="46px"
                  className="size-[46px] rounded-[11px] object-cover"
                />
              ) : (
                <span className="grid size-[46px] place-items-center rounded-[11px] bg-accent-subtle text-accent">
                  <Download className="size-4" />
                </span>
              )}
              <span className="absolute inset-0 grid place-items-center rounded-[11px] bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                <Play className="size-4 fill-white text-white" />
              </span>
            </motion.button>

            <div className="min-w-0 flex-1">
              <Link
                href={`/episode/${item.episodeId}`}
                className="block truncate text-[13.5px] font-semibold hover:underline"
              >
                {item.title}
              </Link>
              <p className="mt-0.5 truncate text-xs text-subtle-2">
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

            <motion.button
              {...press}
              onClick={async () => {
                // Keep the shared set in step, so a download button for this
                // episode elsewhere in the app flips back immediately.
                useDownloadStatus.getState().markRemoved(item.episodeId);
                await removeDownload(item.episodeId);
                void refresh();
              }}
              aria-label={`Delete download of ${item.title}`}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-surface-hover hover:text-danger"
            >
              <Trash2 className="size-[17px]" strokeWidth={1.8} />
            </motion.button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What is on this device, against what the browser will allow.
 *
 * The quota is the browser's own estimate for this origin and it is neither a
 * setting nor a promise — it moves with free disk space and with how recently
 * the site was used. So the bar is drawn from measurements rather than from a
 * plan, and it separates this app's audio from everything else the origin has
 * stored, because those are the two numbers with different remedies: one is
 * fixed by deleting an episode, the other is not.
 */
function StorageMeter({
  episodes,
  storage,
  count,
}: {
  episodes: number;
  storage: { usage: number; quota: number } | null;
  count: number;
}) {
  const quota = storage?.quota ?? 0;
  const other = Math.max(0, (storage?.usage ?? episodes) - episodes);

  const pct = (value: number) => (quota > 0 ? Math.min(100, (value / quota) * 100) : 0);

  return (
    <div className="rounded-app-lg border border-border-2 bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold">{formatBytes(episodes)} of audio</p>
        {quota > 0 && (
          <p className="text-[12.5px] tabular-nums text-subtle-2">
            about {formatBytes(quota)} available
          </p>
        )}
      </div>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-track">
        <span className="bg-accent" style={{ width: `${pct(episodes)}%` }} />
        <span className="bg-clay" style={{ width: `${pct(other)}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap gap-4.5">
        <Legend colour="bg-accent">
          {count} episode{count === 1 ? "" : "s"} · {formatBytes(episodes)}
        </Legend>
        {other > 0 && (
          <Legend colour="bg-clay">Transcripts and app data · {formatBytes(other)}</Legend>
        )}
      </div>
    </div>
  );
}

function Legend({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-2">
      <span aria-hidden className={`size-2 rounded-[2px] ${colour}`} />
      {children}
    </span>
  );
}
