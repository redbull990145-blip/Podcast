"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TWEEN } from "@/lib/motion/config";
import { cn } from "@/lib/utils";

/** Pointer must rest this long before a tooltip appears. */
const OPEN_DELAY_MS = 350;

/**
 * A hover label for controls whose state is worth reading before clicking.
 *
 * Deliberately not a `title` attribute: the browser's own tooltip takes about a
 * second to appear, can't be styled to match, and never shows on touch. This
 * one also opens on focus, so the same information reaches someone tabbing
 * through the transport.
 *
 * It renders nothing until shown, and holds no timers when idle — these sit in
 * the player bar, which is on screen for the entire session.
 */
export function Tooltip({
  label,
  children,
  tone = "light",
  disabled,
  className,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "light" | "surface";
  /**
   * Suppresses the tooltip entirely.
   *
   * Used when the control's own panel is open: both anchor above the same
   * button, so the tooltip would sit on top of the thing it was inviting you
   * to open — and repeat information already on screen.
   */
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = open && !disabled;

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const show = () => {
    cancel();
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };

  const hide = () => {
    cancel();
    setOpen(false);
  };

  return (
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={(e) => {
        // A touch "hover" fires once and never leaves, which would pin the
        // tooltip open over the control the finger is about to press.
        if (e.pointerType === "mouse") show();
      }}
      onPointerLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={hide}
      // Pressing the control has answered the question the tooltip was asking.
      onPointerDown={hide}
    >
      {children}

      <AnimatePresence>
        {visible && (
          <motion.span
            role="tooltip"
            // The centring shift is a motion value, not a `-translate-x-1/2`
            // class: Motion writes the whole `transform`, so a class translate
            // on the same element would be silently dropped.
            initial={{ opacity: 0, x: "-50%", y: 4, scale: 0.96 }}
            animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
            exit={{ opacity: 0, x: "-50%", y: 2, scale: 0.98, transition: TWEEN.fast }}
            transition={TWEEN.normal}
            className={cn(
              "pointer-events-none absolute bottom-full left-1/2 z-[70] mb-2",
              "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-medium tabular-nums",
              "origin-bottom shadow-[var(--shadow-lifted)]",
              tone === "light"
                ? "bg-neutral-900/95 text-white backdrop-blur-xl"
                : "border border-border bg-surface text-foreground",
            )}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
