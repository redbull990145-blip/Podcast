"use client";

import { AnimatePresence, motion } from "motion/react";
import { Loader2, Pause, Play } from "lucide-react";
import { SPRING } from "@/lib/motion/config";
import { cn } from "@/lib/utils";

/**
 * Play / pause / buffering, cross-faded rather than swapped.
 *
 * Hard-swapping the glyph is the single most noticeable cheapness in a web
 * player: the control is the one thing the user is looking at when they click
 * it, so a one-frame substitution is exactly where the eye is. Rotating the
 * outgoing icon out and the incoming one in — over about 120ms — costs nothing
 * and is the difference between a button and a mechanism.
 *
 * `mode="popLayout"` takes the leaving icon out of flow so the two never fight
 * over the same grid cell mid-transition.
 */
export function TransportIcon({
  isPlaying,
  isBuffering,
  className,
}: {
  isPlaying: boolean;
  isBuffering: boolean;
  className?: string;
}) {
  const state = isBuffering ? "buffering" : isPlaying ? "playing" : "paused";

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={state}
        initial={{ opacity: 0, scale: 0.6, rotate: -25 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={{ opacity: 0, scale: 0.6, rotate: 25 }}
        transition={SPRING.snappy}
        className="grid place-items-center"
      >
        {state === "buffering" ? (
          <Loader2 className={cn("animate-spin", className)} />
        ) : state === "playing" ? (
          <Pause className={cn("fill-current", className)} />
        ) : (
          <Play className={cn("translate-x-px fill-current", className)} />
        )}
      </motion.span>
    </AnimatePresence>
  );
}
