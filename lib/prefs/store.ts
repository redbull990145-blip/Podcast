"use client";

import { create } from "zustand";

/**
 * Interface preferences that only affect this browser.
 *
 * Power user mode is progressive disclosure, nothing more: it reveals
 * shortcuts, filters and per-show controls that would clutter the default view.
 * Nothing behind it is paid, and nothing behind it is required — the app is
 * fully usable with it off, which is the whole point.
 *
 * Kept in localStorage rather than the database so toggling is instant and
 * works before the first server round-trip. It is a view preference, not data.
 */

import type { EpisodeFilter } from "@/lib/episodes/filters";
import type { Intensity } from "@/lib/artwork/types";

export type { EpisodeFilter };

type PrefsState = {
  powerMode: boolean;
  episodeFilter: EpisodeFilter;
  /**
   * How much the Now Playing artwork moves while an episode plays.
   *
   * A view preference in exactly the sense this store is for, and it belongs
   * here rather than in the database for the same reason power mode does:
   * toggling should be instant and should work before any server round-trip.
   *
   * Note this is *not* the accessibility control. `prefers-reduced-motion` is
   * read separately and overrides this unconditionally — someone who has asked
   * the OS for less motion gets none regardless of what is saved here.
   */
  artworkMotion: Intensity;
  /** Whether the keyboard shortcut reference is open. */
  shortcutsOpen: boolean;
  /** False until localStorage has been read, so SSR and hydration agree. */
  hydrated: boolean;

  setPowerMode: (on: boolean) => void;
  setEpisodeFilter: (filter: EpisodeFilter) => void;
  setArtworkMotion: (intensity: Intensity) => void;
  setShortcutsOpen: (open: boolean) => void;
  hydrate: () => void;
};

const STORAGE_KEY = "cadence-prefs";

function persist(state: Pick<PrefsState, "powerMode" | "episodeFilter" | "artworkMotion">) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        powerMode: state.powerMode,
        episodeFilter: state.episodeFilter,
        artworkMotion: state.artworkMotion,
      }),
    );
  } catch {
    // Private browsing and full storage both land here; a lost preference is
    // not worth interrupting anyone over.
  }
}

export const usePrefs = create<PrefsState>((set, get) => ({
  // Always starts off. Reading localStorage during the initial render would
  // make the server's HTML and the client's first paint disagree, so the real
  // value is applied in an effect via hydrate().
  powerMode: false,
  episodeFilter: "all",
  artworkMotion: "medium",
  shortcutsOpen: false,
  hydrated: false,

  hydrate() {
    if (get().hydrated) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<PrefsState>) : {};
      set({
        powerMode: parsed.powerMode === true,
        episodeFilter: isFilter(parsed.episodeFilter) ? parsed.episodeFilter : "all",
        artworkMotion: isIntensity(parsed.artworkMotion) ? parsed.artworkMotion : "medium",
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setPowerMode(powerMode) {
    set({ powerMode });
    // Filters are a power-mode surface; leaving one applied after switching it
    // off would hide episodes with no visible way to get them back.
    if (!powerMode) set({ episodeFilter: "all" });
    persist(get());
  },

  setEpisodeFilter(episodeFilter) {
    set({ episodeFilter });
    persist(get());
  },

  setArtworkMotion(artworkMotion) {
    set({ artworkMotion });
    persist(get());
  },

  setShortcutsOpen(shortcutsOpen) {
    set({ shortcutsOpen });
  },
}));

function isIntensity(value: unknown): value is Intensity {
  return (
    value === "off" || value === "subtle" || value === "medium" || value === "expressive"
  );
}

function isFilter(value: unknown): value is EpisodeFilter {
  return (
    value === "all" || value === "unplayed" || value === "in_progress" || value === "played"
  );
}

/** Shared so the help overlay and the handler can never drift apart. */
export const SHORTCUTS: { keys: string; description: string; powerOnly?: boolean }[] = [
  { keys: "Space", description: "Play or pause" },
  { keys: "→", description: "Skip forward" },
  { keys: "←", description: "Skip back" },
  { keys: "J / L", description: "Skip back / forward", powerOnly: true },
  { keys: "K", description: "Play or pause", powerOnly: true },
  { keys: "+ / −", description: "Faster / slower playback", powerOnly: true },
  { keys: "0", description: "Reset speed to 1×", powerOnly: true },
  { keys: "M", description: "Mute or unmute", powerOnly: true },
  { keys: "N", description: "Open Now Playing", powerOnly: true },
  { keys: "C", description: "Toggle captions", powerOnly: true },
  { keys: "?", description: "Show this list", powerOnly: true },
];
