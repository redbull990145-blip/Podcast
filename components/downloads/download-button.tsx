"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, Trash2 } from "lucide-react";
import {
  downloadEpisode,
  isDownloadSupported,
  isDownloaded,
  removeDownload,
  type DownloadedEpisode,
} from "@/lib/offline/downloads";
import { cn } from "@/lib/utils";

type State = "checking" | "idle" | "downloading" | "done" | "error";

export function DownloadButton({
  episode,
  variant = "icon",
  className,
}: {
  episode: Omit<DownloadedEpisode, "bytes" | "downloadedAt">;
  variant?: "icon" | "labelled";
  className?: string;
}) {
  const [state, setState] = useState<State>("checking");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isDownloadSupported()) {
      setState("idle");
      return;
    }
    void isDownloaded(episode.episodeId).then((has) => {
      if (!cancelled) setState(has ? "done" : "idle");
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [episode.episodeId]);

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
      setState("done");
      setPercent(100);
    } else {
      setState("error");
      setError(result.error);
    }
  }

  async function remove() {
    await removeDownload(episode.episodeId);
    setState("idle");
    setPercent(0);
  }

  const label =
    state === "done"
      ? "Remove download"
      : state === "downloading"
        ? `Downloading, ${percent}%`
        : "Download for offline";

  function onClick() {
    if (state === "done") void remove();
    else if (state === "idle" || state === "error") void start();
    else if (state === "downloading") abortRef.current?.abort();
  }

  const icon =
    state === "downloading" ? (
      <Loader2 className="size-4 animate-spin" />
    ) : state === "done" ? (
      <Check className="size-4 text-success" />
    ) : (
      <Download className="size-4" />
    );

  if (variant === "labelled") {
    return (
      <div className={className}>
        <button
          onClick={onClick}
          disabled={state === "checking"}
          className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-app)] border border-border bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-hover disabled:opacity-60"
        >
          {state === "done" ? <Trash2 className="size-4" /> : icon}
          {state === "done"
            ? "Downloaded"
            : state === "downloading"
              ? `${percent}%`
              : "Download"}
        </button>
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={state === "checking"}
      aria-label={label}
      title={label}
      className={cn(
        "relative grid size-8 place-items-center rounded-lg text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground",
        state === "done" && "text-success",
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
