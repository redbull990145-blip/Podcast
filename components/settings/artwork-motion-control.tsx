"use client";

import { useEffect } from "react";
import { useReducedMotion } from "motion/react";
import { usePrefs } from "@/lib/prefs/store";
import type { Intensity } from "@/lib/artwork/types";
import { cn } from "@/lib/utils";

/**
 * How much the Now Playing artwork moves while an episode plays.
 *
 * Worth a control at all because the effect is deliberately near the threshold
 * of notice, and where that threshold sits is not the same for everyone —
 * "subtle" and "expressive" are the same animation at roughly half and one and
 * a half times the amplitude, not different effects.
 *
 * When the operating system asks for reduced motion this reports itself as
 * overridden and stops accepting input. That is the honest presentation: the
 * engine already ignores this setting in that case, and a control that appears
 * to do something it cannot is worse than one that explains itself.
 */
const CHOICES: Array<{ value: Intensity; label: string }> = [
  { value: "off", label: "Off" },
  { value: "subtle", label: "Subtle" },
  { value: "medium", label: "Medium" },
  { value: "expressive", label: "More" },
];

export function ArtworkMotionControl() {
  const value = usePrefs((s) => s.artworkMotion);
  const setValue = usePrefs((s) => s.setArtworkMotion);
  const hydrate = usePrefs((s) => s.hydrate);
  const hydrated = usePrefs((s) => s.hydrated);
  const reducedMotion = useReducedMotion();

  // The store starts at its default so the server's HTML and the first client
  // render agree; the saved value is read here, after mount.
  useEffect(() => hydrate(), [hydrate]);

  if (reducedMotion) {
    return (
      <p className="max-w-56 text-right text-xs leading-relaxed text-muted-foreground">
        Off — your system asks for reduced motion, which overrides this.
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label="Artwork motion"
      className="flex gap-1 rounded-full bg-surface-raised p-1"
    >
      {CHOICES.map((choice) => (
        <button
          key={choice.value}
          onClick={() => setValue(choice.value)}
          // Until localStorage has been read the displayed value is the default
          // rather than the saved one, so nothing claims to be selected yet.
          aria-pressed={hydrated && value === choice.value}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-200 ease-[var(--ease-out)]",
            hydrated && value === choice.value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
