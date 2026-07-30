"use client";

import { useEffect, useRef, useState } from "react";
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
 * commit, for both a drag and a click — with pointer and key handlers as
 * belt-and-braces for older engines.
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

  // Live-updates during a drag; falls back to the real position otherwise.
  const displayTime = dragging ?? currentTime;
  const progress = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;

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

  return (
    <div className={cn("relative", className)}>
      <div className={cn("h-1 w-full overflow-hidden rounded-full bg-border", trackClassName)}>
        <div
          className={cn("h-full bg-accent", fillClassName)}
          // Skip the width transition while dragging, or the fill lags the thumb.
          style={{
            width: `${progress}%`,
            transition: dragging == null ? "width 100ms linear" : "none",
          }}
        />
      </div>

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
