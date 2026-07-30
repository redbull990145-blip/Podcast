"use client";

import { AnimatePresence, motion } from "motion/react";
import { SPRING } from "@/lib/motion/config";
import { cn } from "@/lib/utils";

/**
 * A speaker that actually shows the level.
 *
 * Drawn here rather than taken from the icon set because the set tops out at
 * two arcs, and two arcs cannot distinguish "half" from "full" — which is the
 * one thing a volume icon is for. Three arcs give four distinct states across
 * the range, so the icon alone tells you where you are without reading the
 * percentage next to it.
 *
 * The arc radii climb 4 / 8 / 12 around a chord that grows with them, so each
 * one sits parallel to the last instead of converging. Their right edges land
 * at x ≈ 13.4, 17.3 and 21.1, comfortably inside the 24-unit box.
 */

/** Level at or above which all three arcs show. */
const FULL = 0.67;
/** Level at or above which two arcs show. */
const MEDIUM = 0.34;

const ARCS = [
  "M12.5 9.5a4 4 0 0 1 0 5",
  "M15.5 7a8 8 0 0 1 0 10",
  "M18.5 4.5a12 12 0 0 1 0 15",
] as const;

/** How many arcs a level earns: 0 when silent, then 1, 2 or 3. */
export function arcCount(level: number): number {
  if (level <= 0) return 0;
  if (level >= FULL) return 3;
  if (level >= MEDIUM) return 2;
  return 1;
}

export function VolumeIcon({
  level,
  className,
}: {
  /** Effective level, 0 to 1 — already accounting for mute. */
  level: number;
  className?: string;
}) {
  const arcs = arcCount(level);

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-4", className)}
    >
      {/* Speaker. Sits left of centre to leave room for three arcs. */}
      <path d="M9 5 4.5 9h-3v6h3L9 19Z" />

      <AnimatePresence initial={false}>
        {arcs === 0 ? (
          <motion.g
            key="muted"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={SPRING.snappy}
            style={{ transformOrigin: "17px 12px" }}
          >
            <path d="m13.5 9.5 7 5" />
            <path d="m20.5 9.5-7 5" />
          </motion.g>
        ) : (
          /*
            Each arc fades and grows from the speaker rather than the centre of
            the box, so raising the volume reads as sound spreading outward.
          */
          ARCS.slice(0, arcs).map((d, i) => (
            <motion.path
              key={d}
              d={d}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ ...SPRING.pop, delay: i * 0.02 }}
              style={{ transformOrigin: "6px 12px" }}
            />
          ))
        )}
      </AnimatePresence>
    </svg>
  );
}
