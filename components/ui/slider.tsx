"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Every slider in the app.
 *
 * There used to be two kinds: the seek bar, which was hand-built, and the
 * volume and speed controls, which were bare `<input type="range">` with
 * `accent-color`. Native range inputs draw their own track, thumb and focus
 * ring, and no two browsers agree on any of it — which is exactly why the
 * volume control had a white outlined pill around it while the seek bar
 * directly above was a flat line. One implementation, so they cannot drift.
 *
 * The real input is still a range input, stretched invisibly over the top. That
 * is what keeps keyboard control, screen-reader semantics and touch behaviour
 * working; only the painting is ours.
 *
 * Everything visual is a transform. The fill is a full-width bar scaled on its
 * X axis and the thumb is translated in pixels, so a value that updates
 * continuously — playback position, or a volume drag — never triggers layout.
 */

export type SliderTone = "accent" | "light";

/**
 * `tick` is the colour of the gap punched through the bar at a chapter
 * boundary, so it has to match what is *behind* the slider rather than the
 * slider itself — that is what makes one mark read the same against the played
 * and unplayed halves.
 */
const TONES: Record<SliderTone, { track: string; fill: string; tick: string }> = {
  accent: { track: "bg-border", fill: "bg-accent", tick: "bg-surface" },
  // Sits on the Now Playing backdrop, which is always dark.
  light: { track: "bg-white/20", fill: "bg-white", tick: "bg-black/70" },
};

export function Slider({
  value,
  min = 0,
  max,
  step = 1,
  onInput,
  onCommit,
  disabled,
  ariaLabel,
  ariaValueText,
  tone = "accent",
  className,
  trackClassName,
  ticks,
}: {
  value: number;
  min?: number;
  max: number;
  step?: number;
  /** Fires continuously while dragging — for volume and speed. */
  onInput?: (value: number) => void;
  /**
   * Fires once, when the gesture finishes — for seeking.
   *
   * Committing a seek is fiddlier than it looks. Reading the dragged value out
   * of React state on pointerup breaks for a plain click on the track, because
   * the handler closes over the state from the last render and the pointerup
   * can arrive before React has re-rendered. The seek is then never issued
   * while the thumb stays where it was dropped: the bar reads 52:43, the audio
   * carries on at 20:51, and the position never updates again. So the pending
   * value lives in a ref, and the commit is driven by the element's own
   * `change` event, which fires exactly once for both a drag and a click.
   */
  onCommit?: (value: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  ariaValueText?: string;
  tone?: SliderTone;
  className?: string;
  trackClassName?: string;
  /**
   * Positions to mark on the track, each 0 to 1. Used for chapter boundaries.
   *
   * Fractions rather than values because the marks are a painting concern: they
   * are placed with `left`, so they cost nothing per frame and do not care what
   * the slider's units are.
   */
  ticks?: number[];
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  const displayValue = dragging ?? value;
  const span = max - min;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (displayValue - min) / span)) : 0;

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
      const pending = pendingRef.current;
      pendingRef.current = null;
      setDragging(null);
      if (pending != null) onCommit?.(pending);
    };
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [onCommit]);

  const isDragging = dragging != null;
  const colours = TONES[tone];
  /*
   * Position updates arrive about four times a second; this tween turns those
   * steps back into continuous travel. Off while dragging, or the fill trails
   * the pointer. Off entirely when the caller handles every input itself,
   * since those values are already continuous.
   */
  const glide = isDragging || onInput ? "none" : "transform 260ms linear";

  return (
    <div className={cn("group/slider relative", disabled && "opacity-50", className)}>
      <div
        ref={trackRef}
        className={cn(
          "relative h-1 w-full overflow-hidden rounded-full",
          colours.track,
          trackClassName,
        )}
      >
        <div
          className={cn("h-full w-full origin-left rounded-full", colours.fill)}
          style={{ transform: `scaleX(${fraction})`, transition: glide }}
        />

        {/*
          Chapter marks, cut out of the bar rather than drawn on top of it.
          `mix-blend-overlay` would tint rather than separate, and a solid mark
          has to be one colour against the played side of the bar and another
          against the unplayed side. A gap reads correctly against both, which
          is the same trick a segmented progress bar uses.

          Inside the track, so its `overflow-hidden` clips a mark that lands
          under the rounded cap instead of letting it hang off the end.
        */}
        {ticks?.map((tick) => (
          <span
            key={tick}
            aria-hidden
            className={cn("absolute top-0 h-full w-0.5 -translate-x-1/2", colours.tick)}
            style={{ left: `${tick * 100}%` }}
          />
        ))}
      </div>

      {/*
        Two nested spans so the two transforms never collide: the outer one
        carries position, the inner one the hover reveal. On a single element
        the class-driven scale and the inline translate would fight, and one
        would silently win.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-1/2"
        style={{
          transform: `translate(${fraction * trackWidth}px, -50%)`,
          transition: glide,
        }}
      >
        <span
          className={cn(
            "-ml-1.5 block size-3 rounded-full shadow-[var(--shadow-soft)]",
            colours.fill,
            // Half size, not zero. Growing from nothing is the stock
            // web-animation tell the popover variant's note calls out, and
            // --ease-spring overshoots — from zero that reads as the dot
            // springing into existence rather than swelling under the pointer.
            "scale-50 transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)]",
            "group-hover/slider:scale-100 group-focus-within/slider:scale-100",
            isDragging && "scale-100",
          )}
        />
      </span>

      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        onChange={(event) => {
          const next = Number(event.target.value);
          pendingRef.current = next;
          setDragging(next);
          onInput?.(next);
        }}
        // Invisible, but still the real control: full width, a comfortable
        // vertical hit area, and every native interaction intact.
        className="absolute inset-x-0 -inset-y-2 w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
    </div>
  );
}
