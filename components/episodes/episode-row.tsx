"use client";

import { memo } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2 } from "lucide-react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { QueueButton } from "@/components/queue/queue-button";
import { DownloadButton } from "@/components/downloads/download-button";
import { TransportIcon } from "@/components/player/transport-icon";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { press } from "@/lib/motion/gestures";
import { cn, formatDurationLong, formatRelativeDate } from "@/lib/utils";

export type EpisodeRowData = {
  id: string;
  title: string;
  /** Already stripped of RSS markup by the caller. */
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

/**
 * Memoized because a show page renders fifty of these and the player store
 * updates several times a second while something is playing. Without this, every
 * row re-renders on every tick even though only the playing row can change.
 */
export const EpisodeRow = memo(function EpisodeRow({
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
        <motion.button
          {...press}
          onClick={handlePlay}
          aria-label={
            isCurrent && isPlaying ? `Pause ${episode.title}` : `Play ${episode.title}`
          }
          className={cn(
            "mt-0.5 grid size-10 shrink-0 place-items-center rounded-full border transition-colors",
            isCurrent
              ? "border-accent bg-accent text-accent-foreground"
              : "border-border text-foreground hover:border-accent hover:text-accent",
          )}
        >
          <TransportIcon
            isPlaying={isCurrent && isPlaying}
            isBuffering={isCurrent && isBuffering}
            className="size-4"
          />
        </motion.button>

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
            <span className="flex shrink-0 items-center gap-1">
              <AnimatePresence>
                {progress?.played && (
                  <motion.span
                    title="Played"
                    className="mt-0.5 text-success"
                    aria-label="Played"
                    /*
                      0.5 rather than 0. Growing from nothing is the stock
                      "web animation" tell this app's own popover variant warns
                      against — but this is a 16px status glyph, not a menu, so
                      the 0.96 that reads as "unfolding" at popover size would
                      be invisible here. Half size still arrives; it just
                      arrives as something that was already there.
                    */
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ ...SPRING.pop, opacity: TWEEN.fast }}
                  >
                    <CheckCircle2 className="size-4" />
                  </motion.span>
                )}
              </AnimatePresence>
              <QueueButton episodeId={episode.id} />
              <DownloadButton
                episode={{
                  episodeId: episode.id,
                  enclosureUrl: episode.enclosureUrl,
                  title: episode.title,
                  podcastId: podcast.id,
                  podcastTitle: podcast.title,
                  artworkUrl: episode.imageUrl ?? podcast.artworkUrl,
                  durationSeconds: episode.durationSeconds,
                }}
              />
            </span>
          </div>

          {episode.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {episode.description}
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
              {/*
                scaleX rather than width. A show page renders fifty of these,
                and the playing row's bar updates several times a second — as a
                width that is fifty candidates for layout on every tick.
              */}
              <motion.div
                className="h-full w-full origin-left bg-accent"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: percent / 100 }}
                transition={TWEEN.slow}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
});
