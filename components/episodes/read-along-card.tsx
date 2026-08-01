"use client";

import { motion } from "motion/react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { press } from "@/lib/motion/gestures";

/**
 * Opens the episode in Now Playing with the transcript showing.
 *
 * The transcript lives in the player rather than on this page because it is
 * only useful synced to audio — it highlights the word being spoken and seeks
 * when you click a line. Rendering a second, static copy here would be a
 * different and worse thing wearing the same name, so this starts the episode
 * and takes you to the real one.
 */
export function ReadAlongCard({ episode }: { episode: PlayableEpisode }) {
  const currentId = usePlayer((s) => s.episode?.id);
  const load = usePlayer((s) => s.load);
  const setExpanded = usePlayer((s) => s.setExpanded);
  const setCaptionsOpen = usePlayer((s) => s.setCaptionsOpen);

  const isCurrent = currentId === episode.id;

  function readAlong() {
    if (!isCurrent) load(episode);
    setCaptionsOpen(true);
    setExpanded(true);
  }

  return (
    <div className="rounded-app-lg border border-border-2 bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle-2">
        Transcript
      </p>
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted-2">
        Searchable and synced word by word — the line being spoken lights up, and
        clicking any line jumps the audio there.
      </p>
      <motion.button
        {...press}
        onClick={readAlong}
        className="mt-3.5 h-9.5 w-full rounded-app border border-border-input bg-surface text-[13px] font-medium text-ink-3 transition-colors hover:border-border-strong hover:text-foreground"
      >
        Read along
      </motion.button>
    </div>
  );
}
