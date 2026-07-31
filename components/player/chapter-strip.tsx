"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import type { Chapter } from "@/lib/db/schema";
import { usePlayer } from "@/lib/player/store";
import {
  activeChapterIndex,
  chapterProgress,
  nextChapterStart,
  previousChapterStart,
} from "@/lib/player/chapters";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { press } from "@/lib/motion/gestures";
import { cn } from "@/lib/utils";

/**
 * Shared with ChaptersSection on the episode page, so opening Now Playing for
 * an episode you were just looking at costs no second request.
 */
export function useChapters(episodeId: string) {
  return useQuery({
    queryKey: ["chapters", episodeId],
    queryFn: async () => {
      const res = await fetch(`/api/episodes/${episodeId}/chapters`);
      if (!res.ok) throw new Error("Failed to load chapters");
      return (await res.json()) as { chapters: Chapter[] | null; source: string | null };
    },
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Where you are in the episode, in the episode's own terms.
 *
 * Now Playing knows the time and nothing else, which on a three-hour interview
 * is the least useful thing it could tell you — "1:03:06" answers a question
 * nobody asked. What a listener actually wants to know at a glance is which
 * part they are in and how much of it is left, and a chapter list answers both.
 *
 * The progress bar here measures the *chapter*, not the episode; the seek bar
 * below already covers the episode. Two bars measuring the same span in the
 * same screen would be a duplication, and this way the pair reads as a whole
 * and a part.
 *
 * Position is subscribed to here rather than passed down for the same reason
 * PositionBar exists: it changes about four times a second, and re-rendering
 * Now Playing at that rate would take the artwork and the transcript with it.
 */
export function ChapterStrip({ episodeId }: { episodeId: string }) {
  const { data, isPending, refetch } = useChapters(episodeId);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);

  const chapters = data?.chapters ?? null;

  if (!chapters || chapters.length === 0) {
    // Nothing at all until the answer is in, so the row doesn't appear and then
    // change its mind while the request is in flight.
    if (isPending) return null;
    return <GenerateChapters episodeId={episodeId} onGenerated={() => void refetch()} />;
  }

  const index = activeChapterIndex(chapters, currentTime);
  const previous = previousChapterStart(chapters, currentTime, duration);
  const next = nextChapterStart(chapters, currentTime);

  // Before the first marker there is no chapter to describe — a cold open, or
  // a feed whose chapters start after the intro.
  const chapter = index >= 0 ? chapters[index] : null;
  const progress = index >= 0 ? chapterProgress(chapters, index, currentTime, duration) : 0;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <StepButton
          label="Previous chapter"
          onClick={() => previous != null && seek(previous)}
          disabled={previous == null}
        >
          <ChevronLeft className="size-4" />
        </StepButton>

        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] uppercase tracking-wider text-white/45">
            {chapter
              ? `Chapter ${index + 1} of ${chapters.length}`
              : `${chapters.length} chapters`}
            {data?.source === "ai_generated" && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-white/35">
                <Sparkles className="size-2.5" />
                AI
              </span>
            )}
          </p>

          {/*
            Keyed on the title so a chapter change crossfades rather than
            swapping mid-word. `mode="wait"` because both would otherwise be
            laid out at once and the row would jump to fit the taller of them.
          */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={chapter?.title ?? "before"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={TWEEN.fast}
              className="truncate text-sm font-medium text-white/90"
              title={chapter?.title}
            >
              {chapter?.title ?? "Before the first chapter"}
            </motion.p>
          </AnimatePresence>
        </div>

        <StepButton
          label="Next chapter"
          onClick={() => next != null && seek(next)}
          disabled={next == null}
        >
          <ChevronRight className="size-4" />
        </StepButton>
      </div>

      {/*
        Progress through this chapter. Deliberately thinner and dimmer than the
        seek bar — it is information, not a control, and nothing about it should
        invite a drag.
      */}
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full origin-left rounded-full bg-white/40"
          initial={false}
          animate={{ scaleX: progress }}
          transition={SPRING.transcript}
          style={{ transformOrigin: "left" }}
        />
      </div>
    </div>
  );
}

/**
 * Offered when a show publishes no chapters of its own, which is most of them —
 * `<podcast:chapters>` is in the spec and widely ignored, and none of the feeds
 * this was built against carry it.
 *
 * Deliberately quiet. It sits under the episode title on a screen someone
 * opened to listen, not to spend anything, so it reads as an offer rather than
 * a call to action, and the cost is stated on the button rather than discovered
 * after pressing it.
 */
function GenerateChapters({
  episodeId,
  onGenerated,
}: {
  episodeId: string;
  onGenerated: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId, kind: "chapters" }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Couldn't generate chapters.");
        return;
      }
      onGenerated();
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col items-center">
      <motion.button
        {...press}
        onClick={generate}
        disabled={generating}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs",
          "text-white/60 transition-colors hover:bg-white/10 hover:text-white/90",
          "disabled:pointer-events-none",
        )}
      >
        {generating ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Sparkles className="size-3" />
        )}
        {generating ? "Finding the chapters…" : "Generate chapters"}
      </motion.button>

      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={TWEEN.normal}
            className="mt-1 text-[11px] text-red-300"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {!generating && !error && (
        <p className="mt-0.5 text-[10px] text-white/30">Uses one daily AI credit</p>
      )}
    </div>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      {...press}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full text-white/70 transition-colors",
        "hover:bg-white/15 hover:text-white",
        "disabled:pointer-events-none disabled:opacity-25",
      )}
    >
      {children}
    </motion.button>
  );
}
