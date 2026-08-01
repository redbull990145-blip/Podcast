"use client";

import { motion } from "motion/react";
import { CircleCheck, Loader2, Pause, Play } from "lucide-react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { QueueButton } from "@/components/queue/queue-button";
import { DownloadButton } from "@/components/downloads/download-button";
import { SPRING } from "@/lib/motion/config";
import { pressPrimary } from "@/lib/motion/gestures";
import { formatDurationLong } from "@/lib/utils";

/**
 * The episode's action row.
 *
 * One filled button carrying the whole decision — play, or pick up where you
 * left off, and how much is left — beside a run of equally weighted square
 * controls. Queue and download are deliberately unlabelled here: they are
 * recognisable, they repeat on every episode row in the app, and giving them
 * labels of their own would make three buttons compete with the one that
 * matters.
 */
const SQUARE =
  "grid size-11 shrink-0 place-items-center rounded-app-md border border-border-input bg-surface text-ink-4 transition-colors hover:border-border-strong hover:text-foreground";

export function EpisodePlayButton({
  episode,
  resumeAt,
  played,
}: {
  episode: PlayableEpisode;
  resumeAt: number;
  played: boolean;
}) {
  const currentId = usePlayer((s) => s.episode?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const load = usePlayer((s) => s.load);
  const toggle = usePlayer((s) => s.toggle);

  const isCurrent = currentId === episode.id;
  const canResume = resumeAt > 30 && !played;

  const remaining =
    episode.durationSeconds && episode.durationSeconds > resumeAt
      ? episode.durationSeconds - resumeAt
      : 0;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <motion.button
        {...pressPrimary}
        onClick={() => (isCurrent ? toggle() : load(episode, canResume ? resumeAt : 0))}
        className="inline-flex h-11 items-center gap-2.5 rounded-app-md bg-accent px-5.5 text-[14.5px] font-semibold text-accent-foreground shadow-[var(--shadow-accent)]"
      >
        {isCurrent && isBuffering ? (
          <Loader2 className="size-[15px] animate-spin" />
        ) : isCurrent && isPlaying ? (
          <Pause className="size-[15px] fill-current" />
        ) : (
          <Play className="size-[15px] fill-current" />
        )}
        {isCurrent && isPlaying
          ? "Pause"
          : canResume
            ? remaining > 0
              ? `Resume · ${formatDurationLong(remaining)} left`
              : "Resume"
            : "Play"}
      </motion.button>

      {canResume && (
        <motion.button
          whileTap={{ scale: 0.975 }}
          transition={SPRING.snappy}
          onClick={() => load(episode, 0)}
          className="h-11 shrink-0 rounded-app-md border border-border-input bg-surface px-4.5 text-sm font-medium text-ink-3 transition-colors hover:border-border-strong"
        >
          Start over
        </motion.button>
      )}

      <QueueButton episodeId={episode.id} className={SQUARE} />

      <DownloadButton
        className={SQUARE}
        episode={{
          episodeId: episode.id,
          enclosureUrl: episode.enclosureUrl,
          title: episode.title,
          podcastId: episode.podcastId,
          podcastTitle: episode.podcastTitle,
          artworkUrl: episode.artworkUrl,
          durationSeconds: episode.durationSeconds,
        }}
      />

      {played && (
        <span className="inline-flex items-center gap-1.5 text-sm text-success">
          <CircleCheck className="size-4" />
          Played
        </span>
      )}
    </div>
  );
}
