"use client";

import { motion } from "motion/react";
import { Loader2, Pause, Play } from "lucide-react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { pressPrimary } from "@/lib/motion/gestures";
import { cn } from "@/lib/utils";

/**
 * Starts the newest episode straight from the show's header.
 *
 * Phone-only, and that is a layout fact rather than a feature flag. On desktop
 * the episode list is already on screen beside the header, every row carries
 * its own play button, and the newest is the first of them — a second control
 * for it in the header would be the same action twice, six inches apart.
 *
 * On a 402px screen the header alone is most of the first viewport: the newest
 * episode's row is below the description, below the section heading, and below
 * the fold. So the one thing someone arriving at a show usually wants costs a
 * scroll, and this is what removes it.
 *
 * It plays from the start rather than resuming. The header has no progress to
 * show and no room to explain itself, and "Play latest" quietly picking up at
 * 41 minutes is the kind of surprise that makes people distrust a transport.
 * Resuming lives on the row, where `EpisodePlayButton` says so in its label.
 */
export function PlayLatestButton({
  episode,
  className,
}: {
  episode: PlayableEpisode;
  className?: string;
}) {
  const currentId = usePlayer((s) => s.episode?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const load = usePlayer((s) => s.load);
  const toggle = usePlayer((s) => s.toggle);

  const isCurrent = currentId === episode.id;

  return (
    <motion.button
      {...pressPrimary}
      onClick={() => (isCurrent ? toggle() : load(episode, 0))}
      className={cn(
        "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-app-md",
        "bg-[#f8f6f1] text-[14px] font-semibold text-[#1c1b17]",
        "shadow-[0_1px_3px_rgb(0_0_0_/_0.2)] transition-colors hover:bg-white",
        className,
      )}
    >
      {isCurrent && isBuffering ? (
        <Loader2 className="size-[15px] animate-spin" />
      ) : isCurrent && isPlaying ? (
        <Pause className="size-[15px] fill-current" />
      ) : (
        <Play className="size-[15px] fill-current" />
      )}
      {isCurrent && isPlaying ? "Pause" : "Play latest"}
    </motion.button>
  );
}
