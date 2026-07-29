"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import type { TranscriptSegment } from "@/lib/db/schema";
import { usePlayer } from "@/lib/player/store";
import { cn, formatDuration } from "@/lib/utils";

type TranscriptResponse = {
  segments: TranscriptSegment[] | null;
  source: string | null;
  canGenerate?: boolean;
};

/**
 * Live captions, following the audio the way Apple Podcasts does.
 *
 * Segments come from whichever source is available — the publisher's own
 * <podcast:transcript> when there is one, otherwise a cached Whisper pass — and
 * every line is a seek target, which turns the transcript into a navigation
 * surface rather than a read-only wall of text.
 */
export function CaptionsPanel({ episodeId }: { episodeId: string }) {
  const currentTime = usePlayer((s) => s.currentTime);
  const seek = usePlayer((s) => s.seek);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const listRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  /** Set while we scroll programmatically, so it isn't mistaken for the user. */
  const scrollingRef = useRef(false);

  const { data, isPending, refetch } = useQuery<TranscriptResponse>({
    queryKey: ["transcript", episodeId],
    queryFn: async () => {
      const res = await fetch(`/api/episodes/${episodeId}/transcript`);
      if (!res.ok) throw new Error("Couldn't load captions.");
      return res.json();
    },
    staleTime: Infinity,
  });

  const segments = data?.segments ?? null;

  /**
   * Index of the line being spoken.
   *
   * A linear scan is fine here: transcripts run to a few thousand lines and this
   * only recomputes on the ~4Hz timeupdate, but starting the scan from the
   * previous index keeps it O(1) during normal playback and only walks the whole
   * list after a seek.
   */
  const lastIndexRef = useRef(0);
  const activeIndex = useMemo(() => {
    if (!segments || segments.length === 0) return -1;

    let index = lastIndexRef.current;
    if (index >= segments.length || segments[index].start > currentTime) index = 0;

    while (index + 1 < segments.length && segments[index + 1].start <= currentTime) {
      index += 1;
    }

    lastIndexRef.current = index;
    return currentTime >= segments[index].start ? index : -1;
  }, [segments, currentTime]);

  // Keep the spoken line centred, unless the reader has scrolled away to look
  // at something else — then leave them alone until they scroll back.
  useEffect(() => {
    if (!autoScroll || activeIndex < 0) return;
    const node = activeRef.current;
    if (!node) return;

    scrollingRef.current = true;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    const timer = setTimeout(() => {
      scrollingRef.current = false;
    }, 600);
    return () => clearTimeout(timer);
  }, [activeIndex, autoScroll]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const onScroll = () => {
      if (scrollingRef.current) return;
      const node = activeRef.current;
      if (!node) return;

      // "Near the active line" is the condition for resuming, not "at the
      // bottom" — people scroll up to reread a sentence and expect it to take.
      const listBox = list.getBoundingClientRect();
      const nodeBox = node.getBoundingClientRect();
      const visible = nodeBox.bottom > listBox.top && nodeBox.top < listBox.bottom;
      setAutoScroll(visible);
    };

    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

  async function generate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId, kind: "transcript" }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setGenerateError(payload.error ?? "Couldn't generate captions.");
        return;
      }
      await refetch();
    } catch {
      setGenerateError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setGenerating(false);
    }
  }

  if (isPending) {
    return (
      <div className="grid flex-1 place-items-center text-sm opacity-60">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!segments || segments.length === 0) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm opacity-80">
            {data?.canGenerate === false
              ? "This episode has a transcript, but it has no timings, so captions can't follow along."
              : "This publisher doesn't provide a transcript for this episode."}
          </p>

          {data?.canGenerate !== false && (
            <>
              <button
                onClick={generate}
                disabled={generating}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-5 text-sm font-medium backdrop-blur transition-colors hover:bg-white/25 disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {generating ? "Transcribing…" : "Generate captions"}
              </button>
              <p className="mt-3 text-xs opacity-55">
                Uses one of your daily AI credits. Once generated, everyone gets
                these captions free.
              </p>
            </>
          )}

          {generateError && (
            <p role="alert" className="mt-3 text-xs text-red-300">
              {generateError}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-1 pb-2 text-[11px] uppercase tracking-wide opacity-50">
        <span>{data?.source === "publisher" ? "Publisher transcript" : "AI transcript"}</span>
        {!autoScroll && (
          <button
            onClick={() => setAutoScroll(true)}
            className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] normal-case tracking-normal transition-colors hover:bg-white/25"
          >
            Follow along
          </button>
        )}
      </div>

      <ol
        ref={listRef}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1"
      >
        {segments.map((segment, index) => {
          const isActive = index === activeIndex;
          return (
            <li key={`${segment.start}-${index}`} ref={isActive ? activeRef : undefined}>
              <button
                onClick={() => seek(segment.start)}
                className={cn(
                  "flex w-full gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/10",
                  isActive ? "bg-white/15" : "opacity-55",
                )}
              >
                <span className="shrink-0 pt-0.5 text-[11px] tabular-nums opacity-60">
                  {formatDuration(segment.start)}
                </span>
                <span
                  className={cn(
                    "text-sm leading-relaxed",
                    isActive && "font-medium",
                  )}
                >
                  {segment.text}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
