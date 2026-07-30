"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The seek bar.
 *
 * Committing the seek is fiddlier than it looks. The obvious approach — track
 * the dragged value in state and call seek() on pointerup — breaks for a plain
 * click on the track, because the handler closes over the state from the last
 * render and the pointerup can arrive before React has re-rendered with the new
 * value. The seek is then never issued while the thumb stays where it was
 * dropped: the bar reads 52:43, the audio carries on at 20:51, and the position
 * never updates again because the stale drag value keeps overriding it.
 *
 * So the pending value lives in a ref, never in a closure, and the commit is
 * driven by the element's own `change` event — which fires exactly once, on
 * commit, for both a drag and a click.
 *
 * Visually it is all transforms. The fill is a full-width bar scaled on its X
 * axis and the thumb is translated in pixels, so the steady stream of position
 * updates never touches layout — the same bar animated with `width` or `left`
 * would run a layout pass on the fixed player for every frame of every
 * transition.
 *
 * The thumb's reveal is left to CSS `:hover` rather than a Motion gesture, on
 * purpose: a gesture would re-render this component every time the pointer
 * crossed the bar, and the bar re-renders often enough already.
 */
export function Scrubber({
  currentTime,
  duration,
  onSeek,
  className,
  trackClassName,
  fillClassName,
}: {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  className?: string;
  trackClassName?: string;
  fillClassName?: string;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  // Live-updates during a drag; falls back to the real position otherwise.
  const displayTime = dragging ?? currentTime;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, displayTime / duration)) : 0;

  // The thumb travels in pixels, so the track's width has to be known.
  // Measured on resize only — never per frame.
  useLayoutEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    setTrackWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      setTrackWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const commit = () => {
      const value = pendingRef.current;
      pendingRef.current = null;
      setDragging(null);
      if (value != null) onSeek(value);
    };

    // `change` on a range input means "the user finished choosing" — one event
    // for a click and one for the end of a drag.
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [onSeek]);

  const isDragging = dragging != null;
  // Position updates arrive about four times a second; this tween is what turns
  // those steps back into continuous travel. Off while dragging, or the fill
  // would trail the pointer.
  const glide = isDragging ? "none" : "transform 260ms linear";

  return (
    <div className={cn("group/scrub relative", className)}>
      <div
        ref={trackRef}
        className={cn(
          "h-1 w-full overflow-hidden rounded-full bg-border",
          trackClassName,
        )}
      >
        <div
          className={cn("h-full w-full origin-left bg-accent", fillClassName)}
          style={{ transform: `scaleX(${fraction})`, transition: glide }}
        />
      </div>

      {/*
        Two nested spans so the two transforms never collide: the outer one
        carries position, the inner one carries the hover reveal. A single
        element would need the class-driven scale and the JS-driven translate
        in the same `transform`, and one would silently win.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-1/2"
        style={{ transform: `translate(${fraction * trackWidth}px, -50%)`, transition: glide }}
      >
        <span
          className={cn(
            "-ml-1.5 block size-3 rounded-full bg-accent shadow-[var(--shadow-soft)]",
            "scale-0 transition-transform duration-150 ease-[var(--ease-spring)]",
            "group-hover/scrub:scale-100 group-focus-within/scrub:scale-100",
            isDragging && "scale-100",
            fillClassName,
          )}
        />
      </span>

      <input
        ref={inputRef}
        type="range"
        min={0}
        max={duration || 0}
        step={1}
        // Controlled by the drag value while dragging so the thumb tracks the
        // pointer, and by real playback position the rest of the time.
        value={displayTime}
        aria-label="Seek"
        aria-valuetext={`${Math.floor(displayTime / 60)} minutes ${Math.floor(displayTime % 60)} seconds`}
        disabled={duration <= 0}
        onChange={(event) => {
          const value = Number(event.target.value);
          pendingRef.current = value;
          setDragging(value);
        }}
        className="absolute inset-x-0 -inset-y-2 w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
    </div>
  );
}
