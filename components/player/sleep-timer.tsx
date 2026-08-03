"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minus, Moon, MoonStar, Plus } from "lucide-react";
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

/**
 * The panel's one heading, set the way every other section label in the app is
 * — see `SectionLabel` and the `--text-micro` step. Small, uppercase and widely
 * tracked reads as a label; sentence case at the same size reads as a sentence
 * that has been shrunk.
 */
const LABEL = "text-[10.5px] font-semibold uppercase tracking-[0.12em]";

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
export function SleepTimer({
  tone = "light",
  /**
   * Which side the menu opens on.
   *
   * "top" is right everywhere the control sits in a bar along the bottom of the
   * screen. On a phone it moves into Now Playing's header instead, where above
   * is off-screen — so it opens downward and hugs the right edge rather than
   * centring on a 44px button 8px from it.
   */
  placement = "top",
  className,
}: {
  tone?: "light" | "surface";
  placement?: "top" | "bottom";
  className?: string;
}) {
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
            className,
          )}
        >
          {/* Filled once running: a solid moon reads as "on" at a glance, where
              a change of colour alone does not on a busy backdrop. */}
          <Moon className="size-4" fill={active ? "currentColor" : "none"} />
          {active && sleepTimer !== "episode" && countdown}
        </motion.button>
      </Tooltip>

      {/* Outer element carries the placement; inner one animates. */}
      <div
        className={cn(
          "absolute z-50 w-52",
          placement === "bottom"
            ? "right-0 top-full mt-2"
            : "bottom-full left-1/2 mb-2 -translate-x-1/2",
        )}
      >
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
                "p-3.5",
                placement === "bottom" ? "origin-top-right" : "origin-bottom",
                // Two materials, both already defined: glass over the Now
                // Playing backdrop, and the app's own overlay rung on a page.
                // `.popover-glass` carries its own radius — see the note there.
                light ? "popover-glass text-white" : "elev-overlay rounded-[1rem]",
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
                  <p className={cn(LABEL, light ? "text-white/45" : "text-subtle")}>
                    Stop playing after
                  </p>

                  {/*
                    Borderless until they are worth looking at. Six filled grey
                    blocks are the loudest thing in a panel whose job is to
                    accept one tap — the numbers are the content, and a hairline
                    on hover is enough to say each is a target.
                  */}
                  <div className="mt-2.5 grid grid-cols-3 gap-1">
                    {PRESETS.map((minutes) => (
                      <motion.button
                        {...pressSubtle}
                        key={minutes}
                        onClick={() => choose(minutes)}
                        className={cn(
                          "h-9 rounded-[10px] text-[13px] font-medium tabular-nums transition-colors",
                          light
                            ? "text-white/80 hover:bg-white/10 hover:text-white"
                            : "text-ink-3 hover:bg-surface-raised hover:text-foreground",
                        )}
                      >
                        {minutes}
                        <span
                          className={cn(
                            "ml-0.5 text-[11px]",
                            light ? "text-white/40" : "text-subtle-2",
                          )}
                        >
                          m
                        </span>
                      </motion.button>
                    ))}
                  </div>

                  {/*
                    Below a rule rather than in the grid, because it is not a
                    seventh duration — it is the other kind of answer, and the
                    one most people actually want when they fall asleep to a
                    show. The icon is what makes it read as its own thing at a
                    glance rather than as an odd-length preset.
                  */}
                  <div
                    className={cn(
                      "mt-2.5 border-t pt-2.5",
                      light ? "border-white/10" : "border-border-3",
                    )}
                  >
                    <motion.button
                      {...pressSubtle}
                      onClick={() => choose("episode")}
                      className={cn(
                        "flex h-9 w-full items-center gap-2 rounded-[10px] px-2 text-[13px] font-medium transition-colors",
                        light
                          ? "text-white/80 hover:bg-white/10 hover:text-white"
                          : "text-ink-3 hover:bg-surface-raised hover:text-foreground",
                      )}
                    >
                      <MoonStar
                        className={cn(
                          "size-4 shrink-0",
                          light ? "text-white/50" : "text-subtle",
                        )}
                        strokeWidth={1.75}
                      />
                      End of episode
                    </motion.button>
                  </div>
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
    "grid size-9 place-items-center rounded-full transition-colors disabled:opacity-30",
    light
      ? "text-white/60 hover:bg-white/12 hover:text-white"
      : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
  );

  return (
    <>
      <p className={cn(LABEL, "text-center", light ? "text-white/45" : "text-subtle")}>
        {isEpisode ? "Stopping at" : "Stopping in"}
      </p>

      {/*
        The readout is the whole panel once a timer is running, so it is set
        like one — large, tight and tabular, rather than as a line of body text
        with a label above it. Tabular figures matter more here than anywhere
        else in the app: this number changes every second, and proportional
        digits make the whole thing twitch as they do.
      */}
      <p
        className={cn(
          "mt-1.5 text-center font-semibold tabular-nums",
          isEpisode
            ? "text-[15px] -tracking-[0.01em]"
            : "text-[34px] leading-none -tracking-[0.03em]",
        )}
      >
        {countdown}
      </p>

      {/* Only a wall-clock timer can be nudged; "end of episode" has no dial. */}
      {!isEpisode && (
        <div className="mt-3 flex items-center justify-center gap-1">
          <motion.button
            {...press}
            onClick={() => onNudge(-NUDGE_SECONDS)}
            aria-label="30 seconds less"
            className={nudgeClass}
          >
            <Minus className="size-4" />
          </motion.button>
          <span
            className={cn(
              "w-12 text-center text-[11px] font-medium tabular-nums",
              light ? "text-white/40" : "text-subtle-2",
            )}
          >
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

      <div className={cn("mt-3 border-t pt-2.5", light ? "border-white/10" : "border-border-3")}>
        <motion.button
          {...pressSubtle}
          onClick={onCancel}
          transition={SPRING.snappy}
          className={cn(
            "h-9 w-full rounded-[10px] text-[13px] font-medium transition-colors",
            light
              ? "text-white/70 hover:bg-white/10 hover:text-white"
              : "text-clay hover:bg-clay-subtle hover:text-clay-ink",
          )}
        >
          Cancel timer
        </motion.button>
      </div>
    </>
  );
}
