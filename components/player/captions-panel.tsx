"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { TranscriptSegment } from "@/lib/db/schema";
import { usePlayer } from "@/lib/player/store";
import { activeSegmentIndex } from "@/lib/player/captions";
import {
  centreOn,
  measureRows,
  visibleRange,
  type RowMetrics,
} from "@/lib/player/virtual-list";
import { TranscribeProgress } from "./transcribe-progress";
import { cn, formatDuration } from "@/lib/utils";

type TranscriptResponse = {
  segments: TranscriptSegment[] | null;
  source: string | null;
  canGenerate?: boolean;
};

/**
 * Live captions, following the audio the way Apple Podcasts does.
 *
 * Smoothness came down to two measurements. Re-rendering the transcript on
 * every position update cost about 900ms of blocked main thread per second of
 * playback. Fixing that exposed a subtler limit: on a 2,855-line episode a
 * single `scrollTop` write costs 11ms on its own, because the browser is
 * maintaining a 111,000px scroller full of elements — and an animation that
 * writes scroll position every frame cannot afford that at any frame rate.
 *
 * So only the rows on screen exist in the DOM. Heights are measured once (a
 * transcript never changes after it loads) and every position after that comes
 * from the resulting table.
 */
export function CaptionsPanel({ episodeId }: { episodeId: string }) {
  const seek = usePlayer((s) => s.seek);

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

  if (isPending) {
    return (
      <div className="flex-1 space-y-3 pt-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-4 animate-pulse rounded bg-white/10"
            style={{ width: `${88 - (i % 4) * 14}%` }}
          />
        ))}
      </div>
    );
  }

  if (!segments || segments.length === 0) {
    return (
      <NoCaptions
        episodeId={episodeId}
        canGenerate={data?.canGenerate !== false}
        onGenerated={() => void refetch()}
      />
    );
  }

  return (
    <VirtualTranscript segments={segments} onSeek={seek} source={data?.source ?? null} />
  );
}

function VirtualTranscript({
  segments,
  onSeek,
  source,
}: {
  segments: TranscriptSegment[];
  onSeek: (seconds: number) => void;
  source: string | null;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<RowMetrics | null>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });
  const [autoScroll, setAutoScroll] = useState(true);

  const activeIndex = useActiveSegment(segments);
  // Held in a ref so the scroll listener never needs re-binding per line.
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  /** True while our own animation is driving scrollTop. */
  const selfScrolling = useRef(false);
  const pendingFrame = useRef<number | null>(null);

  /**
   * Which transcript `metrics` describes. Comparing identity rather than
   * holding a boolean flag means a new transcript automatically drops back to
   * the measuring pass instead of reusing another episode's row heights.
   */
  const [measuredFor, setMeasuredFor] = useState<TranscriptSegment[] | null>(null);
  const measuring = measuredFor !== segments;
  const listRef = useRef<HTMLOListElement>(null);

  /**
   * The measuring pass lays every row out in normal flow purely so their
   * heights can be read once; from then on the list is positioned from that
   * table and only the visible slice is rendered.
   *
   * A layout effect, so the full-list frame is measured and replaced before the
   * browser paints it — otherwise the whole transcript flashes on screen first.
   */
  useLayoutEffect(() => {
    if (!measuring) return;
    const node = listRef.current;
    if (!node || node.children.length === 0) return;

    const heights = Array.from(
      node.children,
      (child) => (child as HTMLElement).offsetHeight,
    );
    setMetrics(measureRows(heights, 2));
    setMeasuredFor(segments);
  }, [measuring, segments]);

  const recomputeRange = useCallback(
    (m: RowMetrics) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      setRange(visibleRange(m, scroller.scrollTop, scroller.clientHeight));
    },
    [],
  );

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !metrics) return;

    recomputeRange(metrics);

    const onScroll = () => {
      // Coalesce to one update per frame; scroll events outpace rendering.
      if (pendingFrame.current !== null) return;
      pendingFrame.current = requestAnimationFrame(() => {
        pendingFrame.current = null;
        recomputeRange(metrics);

        if (selfScrolling.current) return;

        // Resume following once the active line is back in view — people scroll
        // up to reread a line and expect it to pick back up.
        const top = metrics.tops[activeIndexRef.current];
        if (top === undefined) return;
        setAutoScroll(
          top >= scroller.scrollTop - 40 &&
            top <= scroller.scrollTop + scroller.clientHeight,
        );
      });
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = null;
    };
  }, [metrics, recomputeRange]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !metrics || !autoScroll || activeIndex < 0) return;

    const rowHeight =
      (metrics.tops[activeIndex + 1] ?? metrics.total) - metrics.tops[activeIndex];
    const target = centreOn(metrics, activeIndex, scroller.clientHeight, rowHeight);
    const from = scroller.scrollTop;
    const distance = target - from;
    if (Math.abs(distance) < 1) return;

    // A long jump — after a seek — isn't worth animating across thousands of
    // pixels; land immediately and redraw the window once.
    if (Math.abs(distance) > scroller.clientHeight * 3) {
      scroller.scrollTop = target;
      return;
    }

    selfScrolling.current = true;
    const duration = Math.min(460, 200 + Math.abs(distance) * 0.4);
    const start = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Mirrors --ease-out: quick departure, gentle settle.
      scroller.scrollTop = from + distance * (1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(step);
      else selfScrolling.current = false;
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      selfScrolling.current = false;
    };
  }, [activeIndex, autoScroll, metrics]);

  // Null while measuring; non-null narrows the positioned branch for TypeScript.
  const positioned = measuring ? null : metrics;
  const rows = positioned ? segments.slice(range.start, range.end) : segments;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-1 pb-2 text-[11px] uppercase tracking-wide opacity-50">
        <span>{source === "publisher" ? "Publisher transcript" : "AI transcript"}</span>
        {!autoScroll && (
          <button
            onClick={() => setAutoScroll(true)}
            className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] normal-case tracking-normal transition-colors hover:bg-white/25"
          >
            Follow along
          </button>
        )}
      </div>

      <div
        ref={scrollerRef}
        // scroll-behavior stays auto: the animation writes scrollTop directly
        // and a native smooth behaviour would fight it.
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scroll-behavior:auto]"
        // One delegated listener instead of a closure per line.
        onClick={(event) => {
          const target = (event.target as HTMLElement).closest("[data-start]");
          if (target) onSeek(Number(target.getAttribute("data-start")));
        }}
      >
        <ol
          ref={listRef}
          className="relative"
          style={positioned ? { height: positioned.total } : undefined}
        >
          {rows.map((segment, i) => {
            const index = positioned ? range.start + i : i;
            const isActive = index === activeIndex;
            return (
              <li
                key={index}
                className={positioned ? "absolute inset-x-0" : "mb-0.5"}
                style={positioned ? { top: positioned.tops[index] } : undefined}
              >
                <button
                  data-start={segment.start}
                  className={cn(
                    "flex w-full gap-3 rounded-lg px-2 py-1.5 text-left",
                    // Only opacity and background animate, both composited, so
                    // following along never triggers layout.
                    "transition-[opacity,background-color] duration-300 hover:bg-white/10",
                    isActive ? "bg-white/15 opacity-100" : "opacity-50",
                  )}
                >
                  <span className="shrink-0 pt-0.5 text-[11px] tabular-nums opacity-60">
                    {formatDuration(segment.start)}
                  </span>
                  <span
                    className={cn("text-sm leading-relaxed", isActive && "font-medium")}
                  >
                    {segment.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/**
 * Tracks which line is being spoken.
 *
 * Subscribes to the store outside React's render cycle, so a position update
 * costs nothing unless it changes the line. The search resumes from the
 * previous index, making playback a constant-time check.
 */
function useActiveSegment(segments: TranscriptSegment[] | null): number {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!segments || segments.length === 0) {
      setActiveIndex(-1);
      return;
    }

    let previous = -1;
    const update = (currentTime: number) => {
      const next = activeSegmentIndex(segments, currentTime, previous);
      if (next !== previous) {
        previous = next;
        setActiveIndex(next);
      }
    };

    update(usePlayer.getState().currentTime);
    return usePlayer.subscribe((state) => update(state.currentTime));
  }, [segments]);

  return activeIndex;
}

function NoCaptions({
  episodeId,
  canGenerate,
  onGenerated,
}: {
  episodeId: string;
  canGenerate: boolean;
  onGenerated: () => void;
}) {
  const duration = usePlayer((s) => s.duration);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId, kind: "transcript" }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Couldn't generate captions.");
        return;
      }
      onGenerated();
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setGenerating(false);
    }
  }

  if (generating) return <TranscribeProgress durationSeconds={duration} />;

  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div className="max-w-sm">
        <p className="text-sm opacity-80">
          {canGenerate
            ? "This publisher doesn't provide a transcript for this episode."
            : "This episode has a transcript, but it has no timings, so captions can't follow along."}
        </p>

        {canGenerate && (
          <>
            <button
              onClick={generate}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-5 text-sm font-medium backdrop-blur transition-[background-color,transform] hover:bg-white/25 active:scale-95"
            >
              <Sparkles className="size-4" />
              Generate captions
            </button>
            <p className="mt-3 text-xs opacity-55">
              Uses one of your daily AI credits. Once generated, everyone gets
              these captions free.
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
