"use client";

import Link from "next/link";
import { CheckCircle2, Loader2, Pause, Play } from "lucide-react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { cn, formatDurationLong, formatRelativeDate, stripHtml } from "@/lib/utils";

export type EpisodeRowData = {
  id: string;
  title: string;
  description: string | null;
  enclosureUrl: string;
  durationSeconds: number | null;
  publishedAt: Date | string | null;
  imageUrl: string | null;
};

export type EpisodeProgress = {
  positionSeconds: number;
  played: boolean;
};

export function EpisodeRow({
  episode,
  podcast,
  progress,
}: {
  episode: EpisodeRowData;
  podcast: { id: string; title: string; artworkUrl: string | null; categories: string[] };
  progress?: EpisodeProgress;
}) {
  const currentId = usePlayer((s) => s.episode?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const load = usePlayer((s) => s.load);
  const toggle = usePlayer((s) => s.toggle);

  const isCurrent = currentId === episode.id;
  const duration = episode.durationSeconds ?? 0;

  // Only treat a saved position as "in progress" if it's meaningfully into the
  // episode — a 4-second position from an accidental tap isn't worth a progress
  // bar, and an all-but-finished one is handled as played by the sync route.
  const position = progress?.positionSeconds ?? 0;
  const inProgress = !progress?.played && position > 30 && duration > 0;
  const percent = inProgress ? Math.min(100, (position / duration) * 100) : 0;
  const remaining = inProgress ? duration - position : duration;

  function handlePlay() {
    if (isCurrent) {
      toggle();
      return;
    }
    const playable: PlayableEpisode = {
      id: episode.id,
      title: episode.title,
      enclosureUrl: episode.enclosureUrl,
      durationSeconds: episode.durationSeconds,
      artworkUrl: episode.imageUrl ?? podcast.artworkUrl,
      podcastId: podcast.id,
      podcastTitle: podcast.title,
      categories: podcast.categories,
    };
    // Resume where they left off, unless they already finished it.
    load(playable, progress?.played ? 0 : position);
  }

  return (
    <li
      className={cn(
        "group rounded-xl border border-transparent px-3 py-3.5 transition-colors hover:border-border hover:bg-surface",
        isCurrent && "border-border bg-surface",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={handlePlay}
          aria-label={
            isCurrent && isPlaying ? `Pause ${episode.title}` : `Play ${episode.title}`
          }
          className={cn(
            "mt-0.5 grid size-10 shrink-0 place-items-center rounded-full border transition-all active:scale-95",
            isCurrent
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border text-foreground hover:border-accent hover:text-accent",
          )}
        >
          {isCurrent && isBuffering ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isCurrent && isPlaying ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 translate-x-px fill-current" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <Link
              href={`/episode/${episode.id}`}
              className={cn(
                "text-sm font-medium leading-snug hover:underline",
                progress?.played && "text-muted-foreground",
              )}
            >
              {episode.title}
            </Link>
            {progress?.played && (
              <span
                title="Played"
                className="mt-0.5 shrink-0 text-success"
                aria-label="Played"
              >
                <CheckCircle2 className="size-4" />
              </span>
            )}
          </div>

          {episode.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {stripHtml(episode.description)}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle-foreground">
            <span>{formatRelativeDate(episode.publishedAt)}</span>
            {duration > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {inProgress
                    ? `${formatDurationLong(remaining)} left`
                    : formatDurationLong(duration)}
                </span>
              </>
            )}
          </div>

          {inProgress && (
            <div
              className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={Math.round(percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Listening progress"
            >
              <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
