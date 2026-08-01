"use client";

import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import type { Chapter } from "@/lib/db/schema";
import { usePlayer } from "@/lib/player/store";
import { PlayingBars } from "@/components/ui/page";
import { pressSubtle } from "@/lib/motion/gestures";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Chapter markers.
 *
 * Support for these is inconsistent across mainstream apps even though many
 * feeds publish them, so a show that went to the trouble of adding chapters
 * gets them honoured here. When they were generated rather than published, that
 * is labelled plainly rather than passed off as the publisher's own.
 */
export function ChapterList({
  chapters,
  source,
  episodeId,
}: {
  chapters: Chapter[];
  source: string | null;
  episodeId: string;
}) {
  const currentTime = usePlayer((s) => s.currentTime);
  const currentEpisodeId = usePlayer((s) => s.episode?.id);
  const seek = usePlayer((s) => s.seek);

  if (chapters.length === 0) return null;

  const isThisEpisode = currentEpisodeId === episodeId;
  const activeIndex = isThisEpisode
    ? chapters.findLastIndex((c) => currentTime >= c.startTime)
    : -1;

  return (
    <section className="mt-9">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold -tracking-[0.01em]">Chapters</h2>
        {source === "ai_generated" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-medium text-accent">
            <Sparkles className="size-3" />
            AI-generated
          </span>
        )}
      </div>

      {/*
        A ruled list rather than a stack of cards. Chapters are an index — the
        eye runs down the timestamps looking for a number — and rules keep those
        aligned in a column, which rounded rows with their own padding do not.
      */}
      <ol className="mt-3 border-t border-border">
        {chapters.map((chapter, index) => {
          const active = index === activeIndex;
          return (
            <li key={`${chapter.startTime}-${chapter.title}`}>
              <motion.button
                // Only the enabled rows press. A disabled chapter row yielding
                // under the finger would promise a seek that cannot happen.
                {...(isThisEpisode ? pressSubtle : {})}
                onClick={() => seek(chapter.startTime)}
                disabled={!isThisEpisode}
                className={cn(
                  "flex w-full items-center gap-3.5 border-b border-border-3 px-1 py-3.5 text-left transition-colors",
                  active
                    ? "text-accent"
                    : "hover:bg-surface-hover disabled:hover:bg-transparent",
                  !isThisEpisode && "cursor-default",
                )}
                title={
                  isThisEpisode
                    ? `Jump to ${formatDuration(chapter.startTime)}`
                    : "Play this episode to jump to a chapter"
                }
              >
                <span
                  className={cn(
                    "w-11 shrink-0 text-xs tabular-nums",
                    active ? "font-semibold text-accent" : "text-subtle-2",
                  )}
                >
                  {formatDuration(chapter.startTime)}
                </span>

                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    active ? "font-medium" : "text-ink-2",
                  )}
                >
                  {chapter.title}
                </span>

                {active && <PlayingBars className="shrink-0" />}
              </motion.button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
