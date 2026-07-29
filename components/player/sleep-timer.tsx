"use client";

import { useEffect, useRef, useState } from "react";
import { Moon } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import { cn } from "@/lib/utils";

const PRESETS = [5, 10, 15, 30, 45, 60];

/** Counts a wall-clock timer down to "12:04"; returns null when nothing is set. */
function useCountdown(target: number | "episode" | null): string | null {
  const [, force] = useState(0);

  useEffect(() => {
    if (typeof target !== "number") return;
    const interval = setInterval(() => force((n) => n + 1), 1_000);
    return () => clearInterval(interval);
  }, [target]);

  if (target === "episode") return "End";
  if (typeof target !== "number") return null;

  const remaining = Math.max(0, Math.round((target - Date.now()) / 1000));
  const minutes = Math.floor(remaining / 60);
  return `${minutes}:${String(remaining % 60).padStart(2, "0")}`;
}

/**
 * Sleep timer.
 *
 * "End of episode" is a first-class option rather than a rounded-up minute
 * count, because that is what people actually want when they fall asleep to a
 * show and don't want to wake to the next one autoplaying.
 */
export function SleepTimer({ tone = "light" }: { tone?: "light" | "surface" }) {
  const sleepTimer = usePlayer((s) => s.sleepTimer);
  const setSleepTimer = usePlayer((s) => s.setSleepTimer);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const countdown = useCountdown(sleepTimer);

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

  const active = sleepTimer != null;

  function choose(value: number | "episode" | null) {
    setSleepTimer(value);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={active ? `Sleep timer, ${countdown} remaining` : "Sleep timer"}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium tabular-nums transition-colors",
          tone === "light"
            ? "text-white/70 hover:bg-white/15 hover:text-white"
            : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          active && (tone === "light" ? "bg-white/20 text-white" : "text-accent"),
        )}
      >
        <Moon className="size-4" />
        {active && countdown}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Sleep timer"
          className={cn(
            "absolute bottom-full left-1/2 z-50 mb-2 w-52 -translate-x-1/2 rounded-xl p-3 shadow-[var(--shadow-lifted)]",
            tone === "light"
              ? "bg-neutral-900/95 text-white backdrop-blur-xl"
              : "border border-border bg-surface",
          )}
        >
          <p className="pb-2 text-xs font-medium opacity-60">Stop playing after</p>

          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((minutes) => (
              <button
                key={minutes}
                onClick={() => choose(minutes)}
                className={cn(
                  "rounded-lg py-1.5 text-xs font-medium tabular-nums transition-colors",
                  tone === "light"
                    ? "bg-white/10 hover:bg-white/20"
                    : "bg-surface-raised hover:bg-surface-hover",
                )}
              >
                {minutes}m
              </button>
            ))}
          </div>

          <button
            onClick={() => choose("episode")}
            className={cn(
              "mt-1.5 w-full rounded-lg py-1.5 text-xs font-medium transition-colors",
              sleepTimer === "episode"
                ? "bg-accent text-accent-foreground"
                : tone === "light"
                  ? "bg-white/10 hover:bg-white/20"
                  : "bg-surface-raised hover:bg-surface-hover",
            )}
          >
            End of episode
          </button>

          {active && (
            <button
              onClick={() => choose(null)}
              className="mt-1.5 w-full rounded-lg py-1.5 text-xs font-medium opacity-70 transition-opacity hover:opacity-100"
            >
              Cancel timer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
