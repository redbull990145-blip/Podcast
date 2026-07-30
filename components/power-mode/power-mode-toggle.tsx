"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { usePrefs } from "@/lib/prefs/store";
import { SPRING } from "@/lib/motion/config";
import { cn } from "@/lib/utils";

/** Reads the stored preferences once the client is up. Mounted in the app shell. */
export function PrefsHydrator() {
  const hydrate = usePrefs((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  return null;
}

/**
 * The one switch that reveals the advanced surface.
 *
 * A single toggle rather than a settings page of individual checkboxes: the
 * complaint it answers is that apps either overwhelm newcomers or bury useful
 * controls from experienced listeners, and asking someone to find eleven
 * separate switches is just the second problem again.
 */
export function PowerModeToggle() {
  const powerMode = usePrefs((s) => s.powerMode);
  const hydrated = usePrefs((s) => s.hydrated);
  const setPowerMode = usePrefs((s) => s.setPowerMode);

  return (
    <motion.button
      role="switch"
      aria-checked={powerMode}
      // Until localStorage has been read the rendered state is a guess, so
      // don't let it be toggled from the wrong starting point.
      disabled={!hydrated}
      onClick={() => setPowerMode(!powerMode)}
      whileTap={hydrated ? { scale: 0.95 } : undefined}
      transition={SPRING.snappy}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-[var(--ease-out)] disabled:opacity-50",
        powerMode ? "bg-accent" : "bg-border-strong",
      )}
    >
      <span className="sr-only">Power user mode</span>
      {/*
        `left-1` matters: an absolutely positioned element with no inset
        anchors itself to where it would have sat in flow, which for the second
        child here is past the label, so the knob rendered outside the pill.

        The knob is the one place in the app that gets a visible overshoot. A
        physical switch has a detent — it arrives with a little more energy than
        it needs and settles — and reproducing that is most of why a toggle
        feels satisfying rather than merely functional.
      */}
      <motion.span
        aria-hidden
        initial={false}
        animate={{ x: powerMode ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 700, damping: 26, mass: 0.7 }}
        className="absolute left-1 top-1 size-5 rounded-full bg-white shadow"
      />
    </motion.button>
  );
}

/** Renders children only when power mode is on. */
export function PowerOnly({ children }: { children: React.ReactNode }) {
  const powerMode = usePrefs((s) => s.powerMode);
  if (!powerMode) return null;
  return <>{children}</>;
}
