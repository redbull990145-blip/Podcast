"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_RATE, MIN_RATE, RATE_STEP, usePlayer } from "@/lib/player/store";
import { cn } from "@/lib/utils";

/** One-tap speeds. The slider covers everything between. */
const PRESETS = [1, 1.25, 1.5, 1.75, 2, 2.5];

/**
 * Playback speed.
 *
 * Deliberately continuous: the common complaint about mainstream apps is being
 * stuck with 1x / 1.5x / 2x when the speed you actually want is 1.35x. Presets
 * remain for the people who just want one tap.
 */
export function SpeedControl() {
  const rate = usePlayer((s) => s.playbackRate);
  const setRate = usePlayer((s) => s.setRate);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  // Trim trailing zeros so 1.50 reads as 1.5 and 1.00 as 1.
  const label = `${Number(rate.toFixed(2))}×`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Playback speed, currently ${label}`}
        className="h-8 min-w-12 rounded-full border border-border px-2.5 text-xs font-semibold tabular-nums text-foreground transition-colors hover:bg-surface-hover"
      >
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Playback speed"
          className="absolute bottom-full right-0 z-50 mb-2 w-60 rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow-lifted)]"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Speed</span>
            <span className="text-sm font-semibold tabular-nums">{label}</span>
          </div>

          <input
            type="range"
            min={MIN_RATE}
            max={MAX_RATE}
            step={RATE_STEP}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            aria-label="Playback speed"
            className="mt-3 w-full accent-[var(--accent)]"
          />

          <div className="mt-1 flex justify-between text-[10px] text-subtle-foreground">
            <span>{MIN_RATE}×</span>
            <span>{MAX_RATE}×</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => setRate(preset)}
                className={cn(
                  "rounded-lg px-2 py-1.5 text-xs font-medium tabular-nums transition-colors",
                  Math.abs(rate - preset) < 0.001
                    ? "bg-accent text-accent-foreground"
                    : "bg-surface-raised text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {preset}×
              </button>
            ))}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-subtle-foreground">
            Pitch stays natural at every speed.
          </p>
        </div>
      )}
    </div>
  );
}
