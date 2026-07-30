"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { MAX_RATE, MIN_RATE, RATE_STEP, usePlayer } from "@/lib/player/store";
import { Slider } from "@/components/ui/slider";
import { press, pressSubtle } from "@/lib/motion/gestures";
import { popover } from "@/lib/motion/variants";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One-tap speeds. The slider covers everything between. */
const PRESETS = [1, 1.25, 1.5, 1.75, 2, 2.5];

/** Trims trailing zeros so 1.50 reads as 1.5 and 1.00 as 1. */
const format = (rate: number) => `${Number(rate.toFixed(2))}×`;

/**
 * Playback speed.
 *
 * Deliberately continuous: the common complaint about mainstream apps is being
 * stuck with 1x / 1.5x / 2x when the speed you actually want is 1.35x. Presets
 * remain for the people who just want one tap, and the −/+ pair steps by a
 * single increment for anyone dialling it in — a 0.05 change is hard to hit on
 * a slider and trivial on a button.
 *
 * The control marks itself when the speed is not 1×, matching the sleep timer.
 * Both answer the same question — "is this doing something to my playback right
 * now?" — and it should not need reading a number to find out.
 */
export function SpeedControl({
  /** "surface" matches the docked bar; "light" sits on the Now Playing backdrop. */
  tone = "surface",
}: {
  tone?: "surface" | "light";
} = {}) {
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

  const label = format(rate);
  const light = tone === "light";
  const active = Math.abs(rate - 1) > 0.001;

  /** Moves one increment from whatever the speed is *now*, not at render time. */
  const step = (direction: 1 | -1) => {
    setRate(usePlayer.getState().playbackRate + direction * RATE_STEP);
  };

  const stepClass = cn(
    "grid size-9 place-items-center rounded-lg transition-colors disabled:opacity-30",
    light ? "bg-white/10 hover:bg-white/20" : "bg-surface-raised hover:bg-surface-hover",
  );

  return (
    <div ref={ref} className="relative">
      <Tooltip
        label={active ? `Playing at ${label}` : "Playback speed"}
        tone={light ? "light" : "surface"}
        disabled={open}
      >
        <motion.button
          {...press}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`Playback speed, currently ${label}`}
          className={cn(
            "h-8 min-w-12 rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors",
            light
              ? "bg-white/15 text-white hover:bg-white/25"
              : "border border-border text-foreground hover:bg-surface-hover",
            active &&
              (light ? "bg-white/30 text-white" : "border-accent bg-accent-subtle text-accent"),
          )}
        >
          {label}
        </motion.button>
      </Tooltip>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={popover}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="dialog"
            aria-label="Playback speed"
            className={cn(
              // Growing from the corner nearest the button reads as the control
              // unfolding rather than a panel appearing over it.
              "absolute bottom-full z-50 mb-2 w-60 rounded-xl p-3 shadow-[var(--shadow-lifted)]",
              light
                ? "left-0 origin-bottom-left bg-neutral-900/95 text-white backdrop-blur-xl"
                : "right-0 origin-bottom-right border border-border bg-surface",
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "text-xs font-medium",
                  light ? "text-white/60" : "text-muted-foreground",
                )}
              >
                Speed
              </span>
              <span className="text-sm font-semibold tabular-nums">{label}</span>
            </div>

            {/* Fine stepping, either side of the current value. */}
            <div className="mt-3 flex items-center gap-2">
              {/*
                The step is taken from the store, not from `rate`, because
                `rate` is this render's value. Three quick presses all run
                before React re-renders, so all three would compute from the
                same starting speed and the control would move one step for
                three clicks.
              */}
              <motion.button
                {...press}
                onClick={() => step(-1)}
                disabled={rate <= MIN_RATE + 0.001}
                aria-label="Slower"
                className={stepClass}
              >
                <Minus className="size-4" />
              </motion.button>

              <Slider
                value={rate}
                min={MIN_RATE}
                max={MAX_RATE}
                step={RATE_STEP}
                onInput={setRate}
                ariaLabel="Playback speed"
                ariaValueText={label}
                tone={light ? "light" : "accent"}
                className="flex-1"
              />

              <motion.button
                {...press}
                onClick={() => step(1)}
                disabled={rate >= MAX_RATE - 0.001}
                aria-label="Faster"
                className={stepClass}
              >
                <Plus className="size-4" />
              </motion.button>
            </div>

            <div
              className={cn(
                "mt-1 flex justify-between px-11 text-[10px]",
                light ? "text-white/50" : "text-subtle-foreground",
              )}
            >
              <span>{MIN_RATE}×</span>
              <span>{MAX_RATE}×</span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {PRESETS.map((preset) => (
                <motion.button
                  {...pressSubtle}
                  key={preset}
                  onClick={() => setRate(preset)}
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-xs font-medium tabular-nums transition-colors",
                    Math.abs(rate - preset) < 0.001
                      ? "bg-accent text-accent-foreground"
                      : light
                        ? "bg-white/10 text-white/75 hover:bg-white/20 hover:text-white"
                        : "bg-surface-raised text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {preset}×
                </motion.button>
              ))}
            </div>

            <p
              className={cn(
                "mt-3 text-[11px] leading-relaxed",
                light ? "text-white/50" : "text-subtle-foreground",
              )}
            >
              Pitch stays natural at every speed.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
