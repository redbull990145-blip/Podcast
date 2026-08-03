"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { RotateCcw, Sparkles } from "lucide-react";
import type { TranscriptSegment } from "@/lib/db/schema";
import { usePlayer } from "@/lib/player/store";
import { captionTime, subscribeClock } from "@/lib/player/playback-clock";
import { activeSegmentIndex, captionLines } from "@/lib/player/captions";
import { repairTranscript } from "@/lib/player/transcript-integrity";
import {
  captionWords,
  centreOffset,
  clampOffset,
  fillFraction,
  fillingWordIndex,
  isRowVisible,
  lineEmphasis,
} from "@/lib/player/caption-motion";
import {
  captionOffsetFor,
  playbackTimeFor,
  resolveAnchors,
  transcriptTimeAt,
  type CaptionAnchor,
  transcriptEndSeconds,
} from "@/lib/player/caption-sync";
import { CaptionSyncControl, useCaptionOffset } from "./caption-sync-control";
import { measureRows, visibleRange, type RowMetrics } from "@/lib/player/virtual-list";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { fade, popover } from "@/lib/motion/variants";
import { press } from "@/lib/motion/gestures";
import { TranscribeProgress } from "./transcribe-progress";
import { Skeleton } from "@/components/ui/page";
import { cn, formatDuration } from "@/lib/utils";

type TranscriptResponse = {
  segments: TranscriptSegment[] | null;
  source: string | null;
  canGenerate?: boolean;
  /**
   * Server's guess at how long generating would take. It knows both the
   * episode's real duration and which provider will serve — neither of which
   * the browser can see.
   */
  estimatedSeconds?: number;
  /**
   * The episode's length as the feed declares it, which is the clean master —
   * the downloaded file is that plus whatever the host stitched in. Only the
   * server knows it; see captionOffsetFor for what it's for.
   */
  publishedDuration?: number | null;
  /**
   * The length of the audio an AI transcript was actually measured from.
   *
   * The counterpart to the above for transcripts we generated: the same host
   * can serve a differently-stitched file to the transcriber and to the
   * listener, and this is the only record of which one the timings belong to.
   * Null for publisher transcripts and for anything generated before it was
   * recorded.
   */
  transcribedDuration?: number | null;
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
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

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
   * Throws away the cached transcript and makes a new one.
   *
   * Offered only for AI transcripts, and only because they can come back
   * genuinely wrong — timings on the wrong clock, or a model that locked into
   * repeating itself — in a way no amount of nudging the offset fixes. A
   * publisher transcript gets no such button: replacing a human-checked one,
   * for every listener, on the strength of one person's ear is not a trade
   * worth offering.
   */
  const regenerate = useCallback(async () => {
    setRegenerating(true);
    setRegenerateError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ episodeId, kind: "transcript", force: true }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setRegenerateError(payload.error ?? "Couldn't regenerate captions.");
        return;
      }
      await refetch();
    } catch {
      setRegenerateError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setRegenerating(false);
    }
  }, [episodeId, refetch]);

  if (regenerating) {
    return <TranscribeProgress estimatedSeconds={data?.estimatedSeconds ?? 60} />;
  }

  if (isPending) {
    return (
      /*
        The app's own `.skeleton` rather than a bespoke pulse.

        The version here previously looped opacity from Motion, which survives
        `prefers-reduced-motion`: MotionConfig's `reducedMotion="user"` strips
        transform and layout animation but deliberately keeps opacity, so
        someone who asked for less motion still got an infinite pulse. The
        shared class is a CSS animation, which the reduced-motion rule in
        globals.css does stop — and it is the same sweep every other loading
        state in the app uses.
      */
      <div className="flex-1 space-y-3 pt-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton
            key={i}
            className="h-4 rounded bg-white/10 [--skeleton-sheen:rgb(255_255_255/0.14)]"
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
        estimatedSeconds={data?.estimatedSeconds}
        onGenerated={() => void refetch()}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AnimatePresence>
        {regenerateError && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={TWEEN.normal}
            className="mb-2 rounded-lg bg-red-500/15 px-2.5 py-1.5 text-xs text-red-200"
          >
            {regenerateError}
          </motion.p>
        )}
      </AnimatePresence>

      <VirtualTranscript
        episodeId={episodeId}
        segments={segments}
        onSeek={seek}
        source={data?.source ?? null}
        publishedDuration={data?.publishedDuration ?? null}
        transcribedDuration={data?.transcribedDuration ?? null}
        onRegenerate={regenerate}
      />
    </div>
  );
}

function VirtualTranscript({
  episodeId,
  segments: provided,
  onSeek,
  source,
  publishedDuration,
  transcribedDuration,
  onRegenerate,
}: {
  episodeId: string;
  segments: TranscriptSegment[];
  onSeek: (seconds: number) => void;
  source: string | null;
  publishedDuration: number | null;
  transcribedDuration: number | null;
  onRegenerate: () => void;
}) {
  const reduceMotion = useReducedMotion() ?? false;

  /**
   * What gets rendered is caption lines, not provider segments — see
   * captionLines. Memoised on identity because the row height table, the
   * windowing and the fill loop all key off this array, and a new one every
   * render would re-measure the whole transcript.
   *
   * Repaired before it is split. `captionLines` and everything downstream of it
   * assume a timeline that only moves forwards, and a transcript stored before
   * `repairTranscript` existed — or fetched live from a publisher's feed, which
   * bypasses the write path entirely — has never been checked against that.
   * `repairTranscript` returns the input by reference when nothing was wrong,
   * so the common case costs one pass and allocates nothing.
   */
  const segments = useMemo(
    () => captionLines(repairTranscript(provided).segments),
    [provided],
  );

  /**
   * How far the captions have to be shifted to match this download.
   *
   * `duration` is the decoded length of the file actually being played, which
   * includes whatever advertising was stitched in on the way. What it gets
   * compared against depends on where the transcript came from: the feed's
   * declared length for a publisher's, and the length measured at transcription
   * time for one of ours. Either way the difference is the shift, and the
   * listener can correct it (see caption-sync-control.tsx).
   *
   * Both cases, and why an AI transcript is no longer assumed to be exempt, are
   * in captionOffsetFor.
   */
  const duration = usePlayer((s) => s.duration);
  /*
   * Only the loaded episode's own show, never whichever show happens to be
   * playing — inheriting a correction from an unrelated podcast would be worse
   * than having none.
   */
  const podcastId = usePlayer((s) =>
    s.episode?.id === episodeId ? s.episode.podcastId : null,
  );
  const { anchors: corrections, adjust, reset } = useCaptionOffset(episodeId, podcastId);
  // Deliberately the settled duration, never the live one — see the hook.
  const autoOffset = captionOffsetFor(
    source,
    useSettledDuration(duration),
    transcriptEndSeconds(segments),
    publishedDuration,
    transcribedDuration,
  );

  /*
   * The guess and the listener's corrections as one stepped timeline.
   *
   * Memoised on identity, not for the arithmetic — which is a handful of
   * additions — but because this array is a dependency of the two effects that
   * subscribe to the playback clock. A fresh array every render would tear down
   * and re-establish both subscriptions on every state change in this panel.
   */
  const anchors = useMemo(
    () => resolveAnchors(autoOffset, corrections),
    [autoOffset, corrections],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  /** The list's translateY. Negative moves later lines into view. */
  const y = useMotionValue(0);

  const [metrics, setMetrics] = useState<RowMetrics | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [range, setRange] = useState({ start: 0, end: 40 });
  const [following, setFollowing] = useState(true);
  const viewportHeight = viewport.height;

  const activeIndex = useActiveSegment(segments, anchors);

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
  useKaraokeFill(segments, activeIndex, range.start, reduceMotion, anchors);

  const positioned = measuring ? null : metrics;
  const rows = positioned ? segments.slice(range.start, range.end) : segments;
  const travel = positioned ? Math.max(0, positioned.total - viewportHeight) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-1 pb-2 text-[11px] uppercase tracking-wide">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate opacity-50">
            {source === "publisher" ? "Publisher transcript" : "AI transcript"}
          </span>
          {source !== "publisher" && (
            <motion.button
              {...press}
              onClick={onRegenerate}
              aria-label="Transcribe this episode again"
              title="Captions don't match the audio? Transcribe again."
              className="grid size-6 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/15 hover:text-white"
            >
              <RotateCcw className="size-3" />
            </motion.button>
          )}
        </span>

        <CaptionSyncControl
          auto={autoOffset}
          corrections={corrections}
          onAdjust={adjust}
          onReset={reset}
        />

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
          // Seek in playback time, which is transcript time plus whatever was
          // stitched in ahead of it — otherwise clicking a line lands early by
          // exactly the amount the captions were out by. How much that is
          // depends on where in the episode the line falls, which is why this
          // is a search rather than an addition; see `playbackTimeFor`.
          if (target) {
            onSeek(playbackTimeFor(anchors, Number(target.getAttribute("data-start"))));
          }
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
                aria-label={`Jump to ${formatDuration(segment.start)}`}
                className={cn(
                  "flex w-full rounded-xl px-2 py-2.5 text-left",
                  "transition-colors duration-[var(--duration-normal)] hover:bg-white/[0.06]",
                )}
              >
                {/*
                  No timestamp column and no tint behind the spoken line. Both
                  were carrying emphasis that the type now carries by itself,
                  and at this size both fought it — a 11px timestamp beside a
                  44px line reads as a mistake, and a filled rounded box behind
                  one line of six turns a transcript into a list of rows. The
                  whole line is still the seek target; `aria-label` keeps the
                  destination available to a screen reader now that it is no
                  longer printed.
                */}
                {/*
                  The inner span is inline on purpose: an inline box broken
                  across lines paints its background as though it were never
                  broken, which is what makes the fill sweep line one and then
                  line two rather than both at once.
                */}
                {/*
                  One element per word, each carrying the slice of the line it
                  occupies. The line publishes a single progress number and
                  every word derives its own fill from it in CSS, which is what
                  keeps the colour inside the word being spoken instead of
                  sweeping the whole sentence. Painting is still one custom
                  property write per frame, not one per word.
                */}
                <span className="caption-line__text">
                  {captionWords(segment).map((word, wordIndex) => (
                    <span
                      key={wordIndex}
                      className="caption-word"
                      style={
                        {
                          "--w-from": word.from,
                          // The reciprocal of the word's width, not the width:
                          // CSS then scales by a multiplication, and nothing
                          // depends on `calc()` dividing by an expression.
                          "--w-scale": 1 / (word.to - word.from),
                        } as React.CSSProperties
                      }
                    >
                      {word.text}{" "}
                    </span>
                  ))}
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

            /*
              A plain `li` with inline values and a CSS transition, not a
              `motion.li` with a spring — this is the difference between the
              scroll holding 60fps and dropping a tenth of its frames.
              Overscan keeps about seventeen rows mounted, and a spring on each
              one means Motion integrating three properties per row per frame
              and writing three inline styles, all on the same main thread that
              is already driving the list's own spring, the karaoke fill loop
              and the active-line loop. Handing opacity and transform to CSS
              moves them to the compositor and takes roughly fifty spring
              integrations a frame off the thread entirely.

              The values only change when the spoken line changes, and blur and
              opacity have no momentum to carry, so a spring was never buying
              anything here — which is what lib/motion/config.ts says to do:
              springs for things that move, tweens for things that fade.

              A row entering the window mounts with its final values already
              set, and a transition needs a previous computed value to run
              from, so it appears at rest rather than animating in. That is the
              same reason the old code passed `initial={false}`.
            */
            return (
              <li
                key={index}
                className="caption-line absolute inset-x-0"
                style={{
                  top: positioned.tops[index],
                  opacity: emphasis.opacity,
                  transform: reduceMotion ? undefined : `scale(${emphasis.scale})`,
                  filter: reduceMotion ? undefined : `blur(${emphasis.blur}px)`,
                }}
              >
                {body}
              </li>
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
 * The whole loop writes one CSS custom property on one element, so nothing here
 * touches React or triggers layout.
 *
 * ## A layout effect, not an effect
 *
 * This has to write the first fill value *before* the browser paints the newly
 * active line. `--caption-fill` defaults to 0 and the word attributes start
 * unset, so a line that is rendered and painted before this runs shows every
 * word in the unspoken colour for that frame — a white line blinking grey at
 * every boundary. With lines now a phrase each that is a flicker every few
 * seconds. `useEffect` fires after paint and cannot avoid it; `useLayoutEffect`
 * fires before, so the line's first painted frame already carries the sweep it
 * should have.
 *
 * ## One clock, sampled once
 *
 * The per-frame callback comes from `subscribeClock`, the same source and the
 * same sample the active-line index is derived from. Running a second frame
 * loop here — which is what this did — meant the two could straddle a line
 * boundary within one frame and paint a fill computed against a segment that
 * was no longer the active one.
 */
function useKaraokeFill(
  segments: TranscriptSegment[],
  activeIndex: number,
  rangeStart: number,
  reduceMotion: boolean,
  anchors: CaptionAnchor[],
) {
  useLayoutEffect(() => {
    const segment = segments[activeIndex];
    if (!segment) return;

    const node = document.querySelector<HTMLElement>("[data-caption-active]");
    if (!node) return;

    const words = captionWords(segment);
    const spans = node.querySelectorAll<HTMLElement>(".caption-word");

    /**
     * Moves the gradient onto whichever word is mid-sweep — see
     * fillingWordIndex for why only one word ever carries it.
     *
     * Runs when the sweep crosses into a new word, which is a few times a
     * second, not once a frame. Everything on the per-frame path below is
     * still a single custom-property write.
     */
    let filling = -2;
    const markWords = (index: number) => {
      for (let i = 0; i < spans.length; i += 1) {
        const span = spans[i];
        span.toggleAttribute("data-sung", i < index);
        span.toggleAttribute("data-filling", i === index);
      }
    };

    const paint = (playback: number) => {
      const time = transcriptTimeAt(anchors, playback);
      // A plain number, not a percentage: the word being swept turns it into
      // its own local fill in CSS, which divides by that word's own width.
      const progress = reduceMotion ? 1 : fillFraction(segment, time);
      node.style.setProperty("--caption-fill", progress.toFixed(4));

      const next = fillingWordIndex(words, progress);
      if (next !== filling) {
        markWords(next);
        filling = next;
      }
    };

    // Reduced motion gets the finished line and no loop at all: a sweep is
    // precisely the moving thing the preference asks not to see.
    if (reduceMotion) {
      paint(captionTime());
      return;
    }

    return subscribeClock(paint);
  }, [segments, activeIndex, rangeStart, reduceMotion, anchors]);
}

/**
 * How long `duration` must hold still before it is trusted to shift captions.
 *
 * Long enough to outlast the revisions a browser makes while it buffers, short
 * enough that a real pre-roll is corrected before anyone has read many lines.
 */
const DURATION_SETTLE_MS = 2_000;

/**
 * The audio's length, once the browser has stopped changing its mind about it.
 *
 * `audio.duration` is not a constant for MP3. Without a Xing header a browser
 * cannot know the length of a variable-bitrate file until it has fetched all of
 * it, so it estimates from the bitrate seen so far and revises the figure as
 * more arrives — and resuming seeks straight into the middle of the file, which
 * is exactly when that estimate is furthest off.
 *
 * The caption offset is derived from that length, so feeding it the live value
 * makes the whole transcript jump partway through an episode: same audio, same
 * transcript, a different guess at the gap between them. Measured here at
 * 3523.2s early against 3514.5s of transcript, it produced a +8s shift that
 * later collapsed to none.
 *
 * Waiting for the number to hold still costs a couple of seconds of unshifted
 * captions at the start — which is the right default anyway, since AI
 * transcripts are timed against the served audio and need no shift at all.
 */
function useSettledDuration(duration: number): number {
  const [settled, setSettled] = useState(0);

  useEffect(() => {
    if (!(duration > 0)) return;
    // The cleanup restarts this on every revision, so it only fires once the
    // figure has held still — which is the whole point.
    const timer = setTimeout(() => setSettled(duration), DURATION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [duration]);

  return settled;
}

/**
 * Tracks which line is being spoken.
 *
 * Driven by `subscribeClock`, which is also what drives the fill — and it has
 * to be the *same* clock, sampled once, or the two disagree about which line is
 * current for a frame at every boundary. See lib/player/playback-clock.ts for
 * why that is one shared loop rather than two careful ones, and for why the
 * clock is not simply `audio.currentTime`.
 *
 * This used to run off the store, which republishes position on `timeupdate`,
 * and browsers fire that about four times a second: every line became current
 * up to a quarter of a second after it was actually spoken. Measured across
 * eighteen line changes on a real episode, a median of 185ms late and never
 * better than 80ms. That was invisible while a "line" was thirty seconds of
 * Whisper's output and boundaries were rare. Now that lines are a phrase each
 * (see captionLines) there is a boundary every few seconds, and at every one of
 * them the highlight stalled at the end of the finished line before jumping —
 * which is exactly what being out of sync looks like.
 *
 * The work is cheap enough to run every frame: one `activeSegmentIndex` call
 * resuming from the previous answer, which is a constant-time check during
 * playback, and React is only told anything when the line actually changes.
 */
function useActiveSegment(
  segments: TranscriptSegment[] | null,
  anchors: CaptionAnchor[],
): number {
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!segments || segments.length === 0) {
      setActiveIndex(-1);
      return;
    }

    let previous = -1;
    return subscribeClock((playback) => {
      const next = activeSegmentIndex(
        segments,
        // Evaluated per frame rather than lifted out, because the shift is a
        // function of the position now — crossing a correction mid-episode has
        // to move the highlight with it. It is a scan of a list with about as
        // many entries as the show has ad breaks.
        transcriptTimeAt(anchors, playback),
        previous,
      );
      if (next !== previous) {
        previous = next;
        setActiveIndex(next);
      }
    });
  }, [segments, anchors]);

  return activeIndex;
}

function NoCaptions({
  episodeId,
  canGenerate,
  estimatedSeconds,
  onGenerated,
}: {
  episodeId: string;
  canGenerate: boolean;
  estimatedSeconds?: number;
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

  // Fall back only if the server didn't say; it almost always does.
  if (generating) return <TranscribeProgress estimatedSeconds={estimatedSeconds ?? 60} />;

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
