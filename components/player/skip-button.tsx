"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { RotateCcw, RotateCw } from "lucide-react";
import { SPRING } from "@/lib/motion/config";
import { press, pressSubtle } from "@/lib/motion/gestures";
import { cn } from "@/lib/utils";

/**
 * Skip back / skip forward.
 *
 * The icon is a circular arrow, so the obvious feedback is the obvious one:
 * pressing it turns the arrow. Each press adds a further part-turn to a running
 * total rather than animating from zero, which means a rapid series of taps
 * keeps spinning in one direction instead of snapping back between each — and
 * the spring carries the velocity from one press into the next.
 *
 * The turn is a third of a revolution. A full 360° would read as a loading
 * spinner, and anything under about 90° is lost at this size.
 */
const TURN = 120;

export function SkipButton({
  direction,
  seconds,
  onClick,
  size = "sm",
}: {
  direction: "forward" | "back";
  seconds: number;
  onClick: () => void;
  /** "sm" for the docked bar, "lg" for Now Playing. */
  size?: "sm" | "lg";
}) {
  const [turns, setTurns] = useState(0);
  const Icon = direction === "forward" ? RotateCw : RotateCcw;
  const large = size === "lg";

  return (
    <motion.button
      /*
        Bundled by size, per the rule in gestures.ts: a larger target needs less
        travel to read as the same press. One hardcoded pair for both sizes had
        the 48px Now Playing button moving further than the 36px docked one —
        and further than `press` gives the icon buttons sitting beside it.
      */
      {...(large ? pressSubtle : press)}
      onClick={() => {
        setTurns((n) => n + (direction === "forward" ? 1 : -1));
        onClick();
      }}
      aria-label={`${direction === "forward" ? "Forward" : "Back"} ${seconds} seconds`}
      title={`${direction === "forward" ? "Forward" : "Back"} ${seconds}s`}
      className={cn(
        "relative grid place-items-center rounded-full transition-colors",
        large
          ? "size-12 text-white/85 hover:bg-white/15 hover:text-white"
          : "size-9 text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <motion.span
        className="grid place-items-center"
        animate={{ rotate: turns * TURN }}
        transition={SPRING.pop}
      >
        <Icon className={large ? "size-8" : "size-5"} strokeWidth={2.5} />
      </motion.span>

      {/*
        The number sits inside the arrow's loop, and must not spin with it —
        so it is a sibling of the rotating span, not a child.
      */}
      <span
        className={cn(
          "pointer-events-none absolute font-bold tabular-nums",
          large ? "text-[10px]" : "text-[8px]",
        )}
      >
        {seconds}
      </span>
    </motion.button>
  );
}
