"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Volume1, Volume2 } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import { ElasticSlider } from "@/components/ui/elastic-slider";
import { press } from "@/lib/motion/gestures";
import { popover } from "@/lib/motion/variants";
import { VolumeIcon } from "./volume-icon";
import { cn } from "@/lib/utils";

/**
 * Module-level so the slider's effect dependencies stay stable across the
 * renders a volume change causes.
 */
const formatPercent = (value: number) => `${Math.round(value)}%`;

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

  if (layout === "inline") {
    return (
      <ElasticSlider
        defaultValue={percent}
        startingValue={0}
        maxValue={100}
        onChange={(v) => setVolume(v / 100)}
        ariaLabel="Volume"
        formatValue={formatPercent}
        leftIcon={
          <motion.button
            {...press}
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="grid size-6 place-items-center opacity-70 transition-opacity hover:opacity-100"
          >
            <VolumeIcon level={effective} />
          </motion.button>
        }
        rightIcon={<Volume2 className="size-3.5 opacity-70" />}
        className={className}
      />
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
      <motion.button
        {...press}
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-expanded={open}
        className={cn(
          "grid size-8 place-items-center rounded-full transition-colors hover:bg-surface-hover",
          muted ? "text-accent" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <VolumeIcon level={effective} />
      </motion.button>

      {/*
        The outer span owns the centring translate and the inner motion element
        owns the animation. Both on one element would mean Motion's inline
        transform silently replacing the `-translate-x-1/2` class.
      */}
      <span className="absolute bottom-full left-1/2 z-50 mb-2 block w-48 -translate-x-1/2">
        <AnimatePresence>
          {open && (
            <motion.span
              variants={popover}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="group"
              aria-label="Volume"
              className="block origin-bottom rounded-xl border border-border bg-surface px-3 pb-2 pt-5 text-foreground shadow-[var(--shadow-lifted)]"
            >
              <ElasticSlider
                defaultValue={percent}
                startingValue={0}
                maxValue={100}
                onChange={(v) => setVolume(v / 100)}
                ariaLabel="Volume"
                formatValue={formatPercent}
                leftIcon={<Volume1 className="size-3.5 opacity-70" />}
                rightIcon={<Volume2 className="size-3.5 opacity-70" />}
              />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}
