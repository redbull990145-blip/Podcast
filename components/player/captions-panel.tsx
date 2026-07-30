"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { TranscriptSegment } from "@/lib/db/schema";
import { usePlayer } from "@/lib/player/store";
import { activeSegmentIndex } from "@/lib/player/captions";
import { TranscribeProgress } from "./transcribe-progress";
import { formatDuration } from "@/lib/utils";

type TranscriptResponse = {
  segments: TranscriptSegment[] | null;
  source: string | null;
  canGenerate?: boolean;
};

/**
 * Live captions, following the audio the way Apple Podcasts does.
 *
 * The thing that makes this feel smooth is what it does *not* do. Position
 * updates arrive about four times a second, and re-rendering a few thousand
 * lines at that rate is what made the first version stutter. So the component
 * subscribes to the player directly and only sets state when the *line* changes
 * — every few seconds — leaving React idle in between. Scrolling is then a
 * single eased animation on the container rather than a browser smooth-scroll
 * that gets cancelled and restarted on each change.
 */
export function CaptionsPanel({ episodeId }: { episodeId: string }) {
  const seek = usePlayer((s) => s.seek);

  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const activeRef = useRef<HTMLLIElement | null>(null);
  /** Set while we animate the scroll, so it isn't mistaken for the user. */
  const selfScrolling = useRef(false);

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
  const activeIndex = useActiveSegment(segments);

  const scrollToActive = useCallback((node: HTMLElement) => {
    const list = listRef.current;
    if (!list) return;

    // Centre the line in the viewport of the list.
    const target =
      node.offsetTop - list.clientHeight / 2 + node.clientHeight / 2;
    const from = list.scrollTop;
    const distance = target - from;
    if (Math.abs(distance) < 1) return;

    selfScrolling.current = true;

    // Hand-rolled rather than `scrollIntoView({behavior:"smooth"})`: the native
    // one restarts from scratch every time it is called, so consecutive lines
    // produce a visible stutter. This one always runs to completion over a
    // fixed duration with the app's own easing curve.
    const duration = Math.min(520, 220 + Math.abs(distance) * 0.35);
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // cubic-bezier(0.22, 1, 0.36, 1) approximated: fast out, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3);
      list.scrollTop = from + distance * eased;

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        selfScrolling.current = false;
      }
    };

    requestAnimationFrame(step);
  }, []);

  // Move the highlight by touching the two affected rows directly. Going
  // through React here would mean rebuilding the whole list — see CaptionLines.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const previous = activeRef.current;
    previous?.querySelector("button")?.removeAttribute("data-active");

    const node = activeIndex >= 0 ? (list.children[activeIndex] as HTMLLIElement) : null;
    activeRef.current = node;
    node?.querySelector("button")?.setAttribute("data-active", "");

    if (node && autoScroll) scrollToActive(node);
  }, [activeIndex, autoScroll, scrollToActive, segments]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const onScroll = () => {
      if (selfScrolling.current) return;
      const node = activeRef.current;
      if (!node) return;

      // Resume following once the active line is back in view, rather than
      // requiring a scroll to the bottom — people scroll up to reread a line
      // and expect following to pick back up when they scroll back.
      const listBox = list.getBoundingClientRect();
      const nodeBox = node.getBoundingClientRect();
      setAutoScroll(nodeBox.bottom > listBox.top && nodeBox.top < listBox.bottom);
    };

    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-1 pb-2 text-[11px] uppercase tracking-wide opacity-50">
        <span>
          {data?.source === "publisher" ? "Publisher transcript" : "AI transcript"}
        </span>
        {!autoScroll && (
          <button
            onClick={() => setAutoScroll(true)}
            className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] normal-case tracking-normal transition-colors duration-200 hover:bg-white/25"
          >
            Follow along
          </button>
        )}
      </div>

      <CaptionLines listRef={listRef} segments={segments} onSeek={seek} />
    </div>
  );
}

/**
 * Tracks which line is being spoken.
 *
 * Subscribes to the store outside React's render cycle so a position update
 * costs nothing unless it actually changes the line. Scanning resumes from the
 * previous index, so normal playback is a constant-time check and only a seek
 * walks the list.
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

/**
 * The transcript, rendered exactly once.
 *
 * Memoized on `segments` alone, so it never re-renders while playing. A
 * transcript can run to several thousand lines, and rebuilding that element
 * tree every time the spoken line advances was costing hundreds of
 * milliseconds of blocked main thread — measured, on a 2,855-line episode, as
 * roughly 2.5 seconds of long tasks per 5 seconds of playback.
 *
 * The highlight is therefore applied imperatively by the parent (see
 * `useHighlight`): two classList writes instead of a full reconciliation.
 * Everything React needs to own here is static.
 */
const CaptionLines = memo(
  function CaptionLines({
    listRef,
    segments,
    onSeek,
  }: {
    listRef: React.RefObject<HTMLOListElement | null>;
    segments: TranscriptSegment[];
    onSeek: (seconds: number) => void;
  }) {
    return (
      <ol
        ref={listRef}
        // scroll-behavior must stay auto: the eased animation sets scrollTop
        // directly and a native smooth behaviour would fight it.
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-1 [scroll-behavior:auto]"
        // One delegated listener rather than 2,855 closures.
        onClick={(event) => {
          const target = (event.target as HTMLElement).closest("[data-start]");
          if (target) onSeek(Number(target.getAttribute("data-start")));
        }}
      >
        {segments.map((segment, index) => (
          <li key={index}>
            <button
              data-start={segment.start}
              className="flex w-full gap-3 rounded-lg px-2 py-1.5 text-left opacity-50 transition-[opacity,background-color] duration-300 ease-[var(--ease-out)] hover:bg-white/10 data-[active]:bg-white/15 data-[active]:opacity-100"
            >
              <span className="shrink-0 pt-0.5 text-[11px] tabular-nums opacity-60">
                {formatDuration(segment.start)}
              </span>
              <span className="text-sm leading-relaxed">{segment.text}</span>
            </button>
          </li>
        ))}
      </ol>
    );
  },
  (a, b) => a.segments === b.segments,
);

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

  if (generating) {
    return <TranscribeProgress durationSeconds={duration} />;
  }

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
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-5 text-sm font-medium backdrop-blur transition-[background-color,transform] duration-200 ease-[var(--ease-out)] hover:bg-white/25 active:scale-95"
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
