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
  /**
   * How the trigger is drawn.
   *
   * "chip" is a bordered pill, which is right in a dense bar of other
   * controls. "bare" is the word alone, for Now Playing's phone row where it
   * sits beside three other bare words and anything drawn around it would be
   * the only box on the screen apart from the play button.
   *
   * A variant rather than a `className` override because the active state —
   * "this is not playing at 1×" — has to survive it, and a class list passed
   * from outside can only flatten it.
   */
  variant = "chip",
  /** Sizing only. The look belongs to `variant`. */
  className,
}: {
  tone?: "surface" | "light";
  variant?: "chip" | "bare";
  className?: string;
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
    "grid size-9 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-30",
    light
      ? "text-white/60 hover:bg-white/12 hover:text-white"
      : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
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
            "tabular-nums transition-colors",
            variant === "bare"
              ? cn(
                  "font-medium",
                  // The rate itself is most of the signal — "1.5×" already says
                  // it is not 1× — so the state is carried by weight of colour
                  // alone, which is all this row uses anywhere.
                  light
                    ? active
                      ? "text-white"
                      : "text-white/45 hover:text-white/80"
                    : active
                      ? "text-accent"
                      : "text-muted-foreground hover:text-foreground",
                )
              : cn(
                  "h-8 min-w-12 rounded-full px-2.5 text-xs font-semibold",
                  light
                    ? "bg-white/15 text-white hover:bg-white/25"
                    : "border border-border text-foreground hover:bg-surface-hover",
                  active &&
                    (light
                      ? "bg-white/30 text-white"
                      : "border-accent bg-accent-subtle text-accent"),
                ),
            className,
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
              "absolute bottom-full z-50 mb-2 w-60 p-3.5",
              // Shared with the sleep timer, so the two controls sitting inches
              // apart are visibly the same kind of object. `.popover-glass`
              // carries its own radius — see the note there.
              light
                ? "popover-glass left-0 origin-bottom-left text-white"
                : "elev-overlay right-0 origin-bottom-right rounded-[1rem]",
            )}
          >
            <div className="flex items-baseline justify-between">
              <span
                className={cn(
                  "text-[10.5px] font-semibold uppercase tracking-[0.12em]",
                  light ? "text-white/45" : "text-subtle",
                )}
              >
                Speed
              </span>
              <span className="text-[15px] font-semibold tabular-nums -tracking-[0.01em]">
                {label}
              </span>
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

            {/* Borderless until one is chosen or hovered — the numbers are the
                content, and six filled blocks under a slider is more furniture
                than a panel this size can carry. Matches the sleep timer. */}
            <div
              className={cn(
                "mt-3 grid grid-cols-3 gap-1 border-t pt-2.5",
                light ? "border-white/10" : "border-border-3",
              )}
            >
              {PRESETS.map((preset) => (
                <motion.button
                  {...pressSubtle}
                  key={preset}
                  onClick={() => setRate(preset)}
                  className={cn(
                    "h-9 rounded-[10px] text-[13px] font-medium tabular-nums transition-colors",
                    Math.abs(rate - preset) < 0.001
                      ? light
                        ? "bg-white/[0.18] text-white"
                        : "bg-accent-subtle text-accent"
                      : light
                        ? "text-white/70 hover:bg-white/10 hover:text-white"
                        : "text-ink-3 hover:bg-surface-raised hover:text-foreground",
                  )}
                >
                  {preset}×
                </motion.button>
              ))}
            </div>

            <p
              className={cn(
                "mt-2.5 text-[11px] leading-relaxed",
                light ? "text-white/40" : "text-subtle-foreground",
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
