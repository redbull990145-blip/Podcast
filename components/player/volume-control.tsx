"use client";

import { useEffect, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import { cn } from "@/lib/utils";

/**
 * Volume, as a slider rather than a mute toggle.
 *
 * The button still mutes on click — that is the muscle memory people arrive
 * with — but the slider is one hover/tap away instead of being unavailable, so
 * you can turn a loud ad down without reaching for the OS mixer.
 */
export function VolumeControl({
  layout = "popover",
  className,
}: {
  /** "popover" for the docked bar; "inline" for the roomy Now Playing screen. */
  layout?: "popover" | "inline";
  className?: string;
}) {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const effective = muted ? 0 : volume;
  const percent = Math.round(effective * 100);
  const Icon = effective === 0 ? VolumeX : effective < 0.5 ? Volume1 : Volume2;

  const slider = (
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={effective}
      onChange={(e) => setVolume(Number(e.target.value))}
      aria-label="Volume"
      aria-valuetext={`${percent}%`}
      className={cn(
        "w-full cursor-pointer accent-[var(--accent)]",
        layout === "inline" && "accent-white",
      )}
    />
  );

  if (layout === "inline") {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <button
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
        >
          <Icon className="size-4" />
        </button>
        {slider}
        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums opacity-60">
          {percent}%
        </span>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      // Hovering reveals it on desktop; the delay stops it snapping shut while
      // the pointer travels from the button down to the slider.
      onPointerEnter={() => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onPointerLeave={() => {
        closeTimer.current = setTimeout(() => setOpen(false), 200);
      }}
    >
      <button
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-expanded={open}
        className={cn(
          "grid size-8 place-items-center rounded-full transition-colors hover:bg-surface-hover",
          muted ? "text-accent" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-4" />
      </button>

      {open && (
        <div
          role="group"
          aria-label="Volume"
          className="absolute bottom-full left-1/2 z-50 mb-2 w-40 -translate-x-1/2 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-lifted)]"
        >
          <div className="flex items-baseline justify-between pb-2">
            <span className="text-xs font-medium text-muted-foreground">Volume</span>
            <span className="text-xs font-semibold tabular-nums">{percent}%</span>
          </div>
          {slider}
        </div>
      )}
    </div>
  );
}
