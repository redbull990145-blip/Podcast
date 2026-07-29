"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, Trash2 } from "lucide-react";
import {
  downloadEpisode,
  removeDownload,
  type DownloadedEpisode,
} from "@/lib/offline/downloads";
import { useDownloadStatus } from "@/lib/offline/download-status";
import { cn } from "@/lib/utils";

/** Local, per-button state. Whether the file exists comes from the shared set. */
type State = "idle" | "downloading" | "error";

export function DownloadButton({
  episode,
  variant = "icon",
  className,
}: {
  episode: Omit<DownloadedEpisode, "bytes" | "downloadedAt">;
  variant?: "icon" | "labelled";
  className?: string;
}) {
  const [state, setState] = useState<State>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ensureLoaded = useDownloadStatus((s) => s.ensureLoaded);
  const statusLoaded = useDownloadStatus((s) => s.loaded);
  const markDownloaded = useDownloadStatus((s) => s.markDownloaded);
  const markRemoved = useDownloadStatus((s) => s.markRemoved);
  // Selecting a boolean rather than the Set keeps a download elsewhere on the
  // page from re-rendering every other row.
  const done = useDownloadStatus((s) => s.ids.has(episode.episodeId));

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    setState("downloading");
    setPercent(0);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const result = await downloadEpisode(
      episode,
      (received, total) => {
        if (total) setPercent(Math.round((received / total) * 100));
      },
      controller.signal,
    );

    if (result.ok) {
      markDownloaded(episode.episodeId);
      setState("idle");
      setPercent(100);
    } else {
      setState("error");
      setError(result.error);
    }
  }

  async function remove() {
    markRemoved(episode.episodeId);
    setPercent(0);
    await removeDownload(episode.episodeId);
  }

  const label = done
    ? "Remove download"
    : state === "downloading"
      ? `Downloading, ${percent}%`
      : "Download for offline";

  function onClick() {
    if (state === "downloading") abortRef.current?.abort();
    else if (done) void remove();
    else void start();
  }

  const icon =
    state === "downloading" ? (
      <Loader2 className="size-4 animate-spin" />
    ) : done ? (
      <Check className="size-4 text-success" />
    ) : (
      <Download className="size-4" />
    );

  if (variant === "labelled") {
    return (
      <div className={className}>
        <button
          onClick={onClick}
          disabled={!statusLoaded}
          className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-app)] border border-border bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          {done ? <Trash2 className="size-4" /> : icon}
          {done ? "Downloaded" : state === "downloading" ? `${percent}%` : "Download"}
        </button>
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={!statusLoaded}
      aria-label={label}
      title={label}
      className={cn(
        "relative grid size-8 place-items-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground",
        done && "text-success",
        className,
      )}
    >
      {icon}
      {state === "downloading" && percent > 0 && (
        <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full bg-accent"
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
    </button>
  );
}
