"use client";

import { Bookmark, Sparkles } from "lucide-react";
import type { Chapter } from "@/lib/db/schema";
import { usePlayer } from "@/lib/player/store";
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
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          Chapters
        </h2>
        {source === "ai_generated" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-medium text-accent">
            <Sparkles className="size-3" />
            AI-generated
          </span>
        )}
      </div>

      <ol className="mt-3 space-y-0.5">
        {chapters.map((chapter, index) => {
          const active = index === activeIndex;
          return (
            <li key={`${chapter.startTime}-${chapter.title}`}>
              <button
                onClick={() => seek(chapter.startTime)}
                disabled={!isThisEpisode}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                  active
                    ? "bg-accent-subtle text-accent"
                    : "hover:bg-surface-hover disabled:hover:bg-transparent",
                  !isThisEpisode && "cursor-default opacity-70",
                )}
                title={
                  isThisEpisode
                    ? `Jump to ${formatDuration(chapter.startTime)}`
                    : "Play this episode to jump to a chapter"
                }
              >
                <span
                  className={cn(
                    "shrink-0",
                    active ? "text-accent" : "text-subtle-foreground",
                  )}
                >
                  <Bookmark
                    className="size-3.5"
                    strokeWidth={active ? 2.5 : 1.75}
                    fill={active ? "currentColor" : "none"}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {chapter.title}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                  {formatDuration(chapter.startTime)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
