"use client";

import { useEffect } from "react";
import { usePrefs } from "@/lib/prefs/store";
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
    <button
      role="switch"
      aria-checked={powerMode}
      // Until localStorage has been read the rendered state is a guess, so
      // don't let it be toggled from the wrong starting point.
      disabled={!hydrated}
      onClick={() => setPowerMode(!powerMode)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
        powerMode ? "bg-accent" : "bg-border-strong",
      )}
    >
      <span className="sr-only">Power user mode</span>
      <span
        aria-hidden
        className={cn(
          "absolute top-1 size-5 rounded-full bg-white shadow transition-transform",
          powerMode ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

/** Renders children only when power mode is on. */
export function PowerOnly({ children }: { children: React.ReactNode }) {
  const powerMode = usePrefs((s) => s.powerMode);
  if (!powerMode) return null;
  return <>{children}</>;
}
