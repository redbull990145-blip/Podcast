"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minus, Moon, Plus } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import { nudgedMinutes } from "@/lib/player/sleep-timer";
import { SPRING } from "@/lib/motion/config";
import { press, pressSubtle } from "@/lib/motion/gestures";
import { popover } from "@/lib/motion/variants";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const PRESETS = [5, 10, 15, 30, 45, 60];

/** How much one nudge moves the deadline. */
const NUDGE_SECONDS = 30;

/** Counts a wall-clock timer down to "12:04"; returns null when nothing is set. */
function useCountdown(target: number | "episode" | null): string | null {
  const [, force] = useState(0);

  useEffect(() => {
    if (typeof target !== "number") return;
    const interval = setInterval(() => force((n) => n + 1), 1_000);
    return () => clearInterval(interval);
  }, [target]);

  if (target === "episode") return "End of episode";
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
 *
 * Once a timer is running the control changes job: it stops being a menu of
 * durations and becomes a readout of how long is left, with a way to buy
 * another half-minute. That is the only thing anyone wants from it at that
 * point — a list of presets would mean starting over.
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
  const light = tone === "light";

  function choose(value: number | "episode" | null) {
    setSleepTimer(value);
    setOpen(false);
  }

  /**
   * Moves the deadline without restarting it.
   *
   * `setSleepTimer` takes **minutes from now**, not a deadline — it is the same
   * call the 5m/10m/15m presets use — so the remaining time has to be converted
   * back into minutes rather than passed through as a timestamp.
   *
   * Clamped at ten seconds rather than zero: nudging down to exactly now would
   * stop playback as a side effect of trying to adjust it, which is not what
   * pressing a minus button should ever do.
   */
  function nudge(deltaSeconds: number) {
    if (typeof sleepTimer !== "number") return;
    setSleepTimer(nudgedMinutes(sleepTimer, Date.now(), deltaSeconds));
  }

  return (
    <div ref={ref} className="relative">
      <Tooltip
        label={active ? `Sleep timer — ${countdown} left` : "Sleep timer"}
        tone={tone}
        disabled={open}
      >
        <motion.button
          {...press}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={active ? `Sleep timer, ${countdown} remaining` : "Sleep timer"}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium tabular-nums transition-colors",
            light
              ? "text-white/70 hover:bg-white/15 hover:text-white"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            active && (light ? "bg-white/20 text-white" : "bg-accent-subtle text-accent"),
          )}
        >
          {/* Filled once running: a solid moon reads as "on" at a glance, where
              a change of colour alone does not on a busy backdrop. */}
          <Moon className="size-4" fill={active ? "currentColor" : "none"} />
          {active && sleepTimer !== "episode" && countdown}
        </motion.button>
      </Tooltip>

      {/* Outer element carries the centring translate; inner one animates. */}
      <div className="absolute bottom-full left-1/2 z-50 mb-2 w-52 -translate-x-1/2">
        <AnimatePresence>
          {open && (
            <motion.div
              variants={popover}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="dialog"
              aria-label="Sleep timer"
              className={cn(
                "origin-bottom rounded-xl p-3 shadow-[var(--shadow-lifted)]",
                light
                  ? "bg-neutral-900/95 text-white backdrop-blur-xl"
                  : "border border-border bg-surface",
              )}
            >
              {active ? (
                <RunningTimer
                  countdown={countdown}
                  isEpisode={sleepTimer === "episode"}
                  light={light}
                  onNudge={nudge}
                  onCancel={() => choose(null)}
                />
              ) : (
                <>
                  <p className="pb-2 text-xs font-medium opacity-60">
                    Stop playing after
                  </p>

                  <div className="grid grid-cols-3 gap-1.5">
                    {PRESETS.map((minutes) => (
                      <motion.button
                        {...pressSubtle}
                        key={minutes}
                        onClick={() => choose(minutes)}
                        className={cn(
                          "rounded-lg py-1.5 text-xs font-medium tabular-nums transition-colors",
                          light
                            ? "bg-white/10 hover:bg-white/20"
                            : "bg-surface-raised hover:bg-surface-hover",
                        )}
                      >
                        {minutes}m
                      </motion.button>
                    ))}
                  </div>

                  <motion.button
                    {...pressSubtle}
                    onClick={() => choose("episode")}
                    className={cn(
                      "mt-1.5 w-full rounded-lg py-1.5 text-xs font-medium transition-colors",
                      light
                        ? "bg-white/10 hover:bg-white/20"
                        : "bg-surface-raised hover:bg-surface-hover",
                    )}
                  >
                    End of episode
                  </motion.button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RunningTimer({
  countdown,
  isEpisode,
  light,
  onNudge,
  onCancel,
}: {
  countdown: string | null;
  isEpisode: boolean;
  light: boolean;
  onNudge: (deltaSeconds: number) => void;
  onCancel: () => void;
}) {
  const nudgeClass = cn(
    "grid size-9 place-items-center rounded-lg transition-colors disabled:opacity-30",
    light ? "bg-white/10 hover:bg-white/20" : "bg-surface-raised hover:bg-surface-hover",
  );

  return (
    <>
      <p className="text-center text-[11px] font-medium uppercase tracking-wide opacity-55">
        {isEpisode ? "Stopping at" : "Stopping in"}
      </p>

      <p
        className={cn(
          "pt-0.5 text-center font-semibold tabular-nums",
          isEpisode ? "text-sm" : "text-2xl",
        )}
      >
        {countdown}
      </p>

      {/* Only a wall-clock timer can be nudged; "end of episode" has no dial. */}
      {!isEpisode && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <motion.button
            {...press}
            onClick={() => onNudge(-NUDGE_SECONDS)}
            aria-label="30 seconds less"
            className={nudgeClass}
          >
            <Minus className="size-4" />
          </motion.button>
          <span className="w-14 text-center text-[11px] tabular-nums opacity-55">
            30s
          </span>
          <motion.button
            {...press}
            onClick={() => onNudge(NUDGE_SECONDS)}
            aria-label="30 seconds more"
            className={nudgeClass}
          >
            <Plus className="size-4" />
          </motion.button>
        </div>
      )}

      <motion.button
        {...pressSubtle}
        onClick={onCancel}
        transition={SPRING.snappy}
        className={cn(
          "mt-3 w-full rounded-lg py-1.5 text-xs font-medium transition-colors",
          light ? "bg-white/10 hover:bg-white/20" : "bg-surface-raised hover:bg-surface-hover",
        )}
      >
        Cancel timer
      </motion.button>
    </>
  );
}
