"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { Sparkles } from "lucide-react";
import type { TranscriptSegment } from "@/lib/db/schema";
import { getAudio, usePlayer } from "@/lib/player/store";
import { activeSegmentIndex } from "@/lib/player/captions";
import {
  centreOffset,
  clampOffset,
  fillFraction,
  isRowVisible,
  lineEmphasis,
} from "@/lib/player/caption-motion";
import { measureRows, visibleRange, type RowMetrics } from "@/lib/player/virtual-list";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { fade, popover } from "@/lib/motion/variants";
import { TranscribeProgress } from "./transcribe-progress";
import { cn, formatDuration } from "@/lib/utils";

type TranscriptResponse = {
  segments: TranscriptSegment[] | null;
  source: string | null;
  canGenerate?: boolean;
};

/** Momentum for a wheel or trackpad flick — stiffer and more damped than the follow spring. */
const WHEEL_SPRING = { type: "spring", stiffness: 420, damping: 46, mass: 0.7 } as const;

/** How long after the last wheel tick to consider the gesture finished. */
const WHEEL_IDLE_MS = 200;

/**
 * Live captions, following the audio the way Apple Music and Apple Podcasts do.
 *
 * The list is positioned by `translateY` on a single element rather than by
 * scrolling a container. That is not stylistic. A scroll container animated
 * frame by frame writes `scrollTop`, which is a main-thread layout operation the
 * compositor cannot help with — on a long episode a single write measured 11ms
 * before this view was virtualised, and even virtualised it forces scroll
 * anchoring and hit-test invalidation every frame. A transform is handed
 * straight to the compositor, so the transcript can glide continuously while
 * React, audio decoding and position syncing share the main thread.
 *
 * Everything the eye picks up on is layered on top of that one moving element:
 * the spoken line sits at full weight and full size, its neighbours fade,
 * shrink a couple of percent and pick up a sub-pixel blur, and the words fill
 * with colour as they are said.
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
          <motion.div
            key={i}
            animate={{ opacity: [0.35, 0.7, 0.35] }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.06,
            }}
            className="h-4 rounded bg-white/10"
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
  const reduceMotion = useReducedMotion() ?? false;

  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  /** The list's translateY. Negative moves later lines into view. */
  const y = useMotionValue(0);

  const [metrics, setMetrics] = useState<RowMetrics | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [range, setRange] = useState({ start: 0, end: 40 });
  const [following, setFollowing] = useState(true);
  const viewportHeight = viewport.height;

  const activeIndex = useActiveSegment(segments);

  /**
   * Which transcript `metrics` describes. Comparing identity rather than
   * holding a boolean means a new transcript automatically drops back to the
   * measuring pass instead of reusing another episode's row heights.
   */
  const [measuredFor, setMeasuredFor] = useState<TranscriptSegment[] | null>(null);
  const measuring = measuredFor !== segments;

  // Read inside listeners that must not be re-bound on every line change.
  const followingRef = useRef(following);
  followingRef.current = following;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  /**
   * The measuring pass lays every row out in normal flow purely so their
   * heights can be read once; from then on the list is positioned from that
   * table and only the visible slice is rendered.
   *
   * A layout effect, so the full-list frame is measured and replaced before the
   * browser paints it — otherwise the whole transcript flashes on screen first.
   */
  /** Width the current height table was measured at. */
  const measuredWidth = useRef(0);

  useLayoutEffect(() => {
    if (!measuring || viewport.width === 0) return;
    const node = listRef.current;
    if (!node || node.children.length === 0) return;

    const heights = Array.from(
      node.children,
      (child) => (child as HTMLElement).offsetHeight,
    );
    setMetrics(measureRows(heights, 2));
    setMeasuredFor(segments);
    measuredWidth.current = viewport.width;
  }, [measuring, segments, viewport.width]);

  // The viewport drives centring and the drag bounds, so it has to be tracked
  // rather than read once — Now Playing resizes and rotates on a phone.
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    setViewport({ width: node.clientWidth, height: node.clientHeight });

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setViewport((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * A width change invalidates the whole position table.
   *
   * Row heights come from how the text wraps, so the same caption is two lines
   * on a desktop and four on a phone. Keeping the desktop table after a rotate
   * stacks every line on top of the one before it. Dropping `measuredFor` sends
   * the list back through the measuring pass at the new width.
   *
   * Height alone is not a reason to re-measure — that only changes how many
   * rows are visible, which the windowing already recomputes.
   */
  useLayoutEffect(() => {
    if (viewport.width === 0 || measuredWidth.current === 0) return;
    if (viewport.width === measuredWidth.current) return;
    setMeasuredFor(null);
  }, [viewport.width]);

  // --- windowing ----------------------------------------------------------
  const syncRange = useCallback(
    (offset: number) => {
      if (!metrics || viewportHeight === 0) return;
      const next = visibleRange(metrics, -offset, viewportHeight);
      // Only a state change when the slice actually differs. The offset moves
      // every frame; the slice it implies changes about once per row.
      setRange((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
    },
    [metrics, viewportHeight],
  );

  useMotionValueEvent(y, "change", syncRange);
  useEffect(() => syncRange(y.get()), [syncRange, y]);

  // --- following the voice -------------------------------------------------
  useEffect(() => {
    if (!metrics || !following || activeIndex < 0 || viewportHeight === 0) return;

    const rowHeight =
      (metrics.tops[activeIndex + 1] ?? metrics.total) - metrics.tops[activeIndex];
    const target = centreOffset(
      metrics.tops,
      metrics.total,
      activeIndex,
      viewportHeight,
      rowHeight,
    );

    const distance = Math.abs(y.get() - target);
    if (distance < 0.5) return;

    // A long jump — after a seek — is not worth travelling across thousands of
    // pixels. Land immediately; there is nothing to follow along the way.
    if (reduceMotion || distance > viewportHeight * 3) {
      y.set(target);
      return;
    }

    const controls = animate(y, target, SPRING.transcript);
    return () => controls.stop();
  }, [activeIndex, following, metrics, viewportHeight, reduceMotion, y]);

  // --- manual browsing -----------------------------------------------------
  /**
   * Touch drags the list directly; a mouse does not.
   *
   * Binding drag to every pointer type would mean a click-and-move over the
   * transcript scrolls it instead of selecting text, and a transcript you
   * cannot copy from is a worse transcript. Trackpads emit wheel events, so
   * they are covered by the handler below rather than by drag.
   */
  const dragControls = useDragControls();

  const wheelTarget = useRef(0);
  const wheelUntil = useRef(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Re-follow if the spoken line is back on screen — no button press needed. */
  const resumeIfActiveVisible = useCallback(() => {
    if (!metrics || followingRef.current) return;
    if (isRowVisible(metrics.tops, activeIndexRef.current, y.get(), viewportHeight)) {
      setFollowing(true);
    }
  }, [metrics, viewportHeight, y]);

  const takeManualControl = useCallback(() => {
    if (followingRef.current) setFollowing(false);
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!metrics || metrics.total <= viewportHeight) return;
      takeManualControl();

      // Chain onto the in-flight target so a fast series of ticks accumulates
      // instead of each one restarting from wherever the spring happens to be.
      const now = performance.now();
      const base = now < wheelUntil.current ? wheelTarget.current : y.get();
      const next = clampOffset(base - event.deltaY, metrics.total, viewportHeight);

      wheelTarget.current = next;
      wheelUntil.current = now + WHEEL_IDLE_MS;
      animate(y, next, WHEEL_SPRING);

      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(resumeIfActiveVisible, WHEEL_IDLE_MS + 60);
    },
    [metrics, viewportHeight, y, takeManualControl, resumeIfActiveVisible],
  );

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  // --- karaoke fill --------------------------------------------------------
  useKaraokeFill(segments, activeIndex, range.start, reduceMotion);

  const positioned = measuring ? null : metrics;
  const rows = positioned ? segments.slice(range.start, range.end) : segments;
  const travel = positioned ? Math.max(0, positioned.total - viewportHeight) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-1 pb-2 text-[11px] uppercase tracking-wide opacity-50">
        <span>{source === "publisher" ? "Publisher transcript" : "AI transcript"}</span>

        <AnimatePresence>
          {!following && (
            <motion.button
              variants={popover}
              initial="hidden"
              animate="visible"
              exit="exit"
              whileTap={{ scale: 0.94 }}
              onClick={() => setFollowing(true)}
              className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] normal-case tracking-normal"
            >
              Follow along
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div
        ref={viewportRef}
        className="caption-viewport relative min-h-0 flex-1 overflow-hidden pr-1"
        onWheel={onWheel}
        onPointerDown={(event) => {
          // Touch and pen drag the list; a mouse is left alone for selection.
          if (event.pointerType !== "mouse" && travel > 0) {
            takeManualControl();
            dragControls.start(event);
          }
        }}
        // One delegated listener instead of a closure per line.
        onClick={(event) => {
          const target = (event.target as HTMLElement).closest("[data-start]");
          if (target) onSeek(Number(target.getAttribute("data-start")));
        }}
      >
        <motion.ol
          ref={listRef}
          className="relative"
          style={positioned ? { y, height: positioned.total } : undefined}
          drag={positioned && travel > 0 ? "y" : false}
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: -travel, bottom: 0 }}
          dragElastic={0.06}
          onDragTransitionEnd={resumeIfActiveVisible}
        >
          {rows.map((segment, i) => {
            const index = positioned ? range.start + i : i;
            const isActive = index === activeIndex;
            const emphasis = lineEmphasis(index, activeIndex);

            const body = (
              <button
                data-start={segment.start}
                data-caption-active={isActive ? "" : undefined}
                className={cn(
                  "flex w-full gap-3 rounded-lg px-2 py-1.5 text-left",
                  "transition-colors duration-300 hover:bg-white/10",
                  isActive && "bg-white/[0.08]",
                )}
              >
                <span className="shrink-0 pt-0.5 text-[11px] tabular-nums opacity-60">
                  {formatDuration(segment.start)}
                </span>
                {/*
                  The inner span is inline on purpose: an inline box broken
                  across lines paints its background as though it were never
                  broken, which is what makes the fill sweep line one and then
                  line two rather than both at once.
                */}
                <span className="text-sm leading-relaxed">
                  <span className="caption-line__text">{segment.text}</span>
                </span>
              </button>
            );

            if (!positioned) {
              return (
                <li key={index} className="caption-line mb-0.5">
                  {body}
                </li>
              );
            }

            return (
              <motion.li
                key={index}
                className="caption-line absolute inset-x-0"
                style={{ top: positioned.tops[index] }}
                initial={false}
                animate={{
                  opacity: emphasis.opacity,
                  scale: reduceMotion ? 1 : emphasis.scale,
                  filter: reduceMotion ? "blur(0px)" : `blur(${emphasis.blur}px)`,
                }}
                transition={SPRING.caption}
              >
                {body}
              </motion.li>
            );
          })}
        </motion.ol>
      </div>
    </div>
  );
}

/**
 * Drives the progressive fill on the line currently being spoken.
 *
 * Reads the audio element directly rather than the store: the store updates on
 * `timeupdate`, which browsers fire about four times a second, and a fill that
 * steps four times a second is exactly the stutter this is meant to avoid.
 *
 * The whole loop writes one CSS custom property on one element, so nothing here
 * touches React or triggers layout. It runs only while audio is actually
 * moving; while paused the value is written once and left alone.
 */
function useKaraokeFill(
  segments: TranscriptSegment[],
  activeIndex: number,
  rangeStart: number,
  reduceMotion: boolean,
) {
  const isPlaying = usePlayer((s) => s.isPlaying);
  // Constant while playing, so this never causes a render mid-playback; while
  // paused it changes on a seek, which is exactly when the fill must catch up.
  const pausedTime = usePlayer((s) => (s.isPlaying ? 0 : s.currentTime));

  useEffect(() => {
    const segment = segments[activeIndex];
    if (!segment) return;

    const node = document.querySelector<HTMLElement>("[data-caption-active]");
    if (!node) return;

    const paint = () => {
      // The element is the finer clock, but only once it actually has media
      // loaded — an element with no source reports 0 forever, which would peg
      // the fill at empty rather than falling back to the store.
      const audio = getAudio();
      const time =
        audio && audio.currentSrc
          ? audio.currentTime
          : usePlayer.getState().currentTime;
      const percent = reduceMotion ? 100 : fillFraction(segment, time) * 100;
      node.style.setProperty("--caption-fill", `${percent.toFixed(2)}%`);
    };

    paint();
    if (!isPlaying || reduceMotion) return;

    let raf = requestAnimationFrame(function tick() {
      paint();
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [segments, activeIndex, rangeStart, isPlaying, pausedTime, reduceMotion]);
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
    <motion.div
      variants={fade}
      initial="hidden"
      animate="visible"
      className="grid flex-1 place-items-center px-6 text-center"
    >
      <div className="max-w-sm">
        <p className="text-sm opacity-80">
          {canGenerate
            ? "This publisher doesn't provide a transcript for this episode."
            : "This episode has a transcript, but it has no timings, so captions can't follow along."}
        </p>

        {canGenerate && (
          <>
            <motion.button
              onClick={generate}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              transition={SPRING.snappy}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-5 text-sm font-medium backdrop-blur hover:bg-white/25"
            >
              <Sparkles className="size-4" />
              Generate captions
            </motion.button>
            <p className="mt-3 text-xs opacity-55">
              Uses one of your daily AI credits. Once generated, everyone gets
              these captions free.
            </p>
          </>
        )}

        <AnimatePresence>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={TWEEN.normal}
              className="mt-3 text-xs text-red-300"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
