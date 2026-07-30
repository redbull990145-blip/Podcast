"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { SHORTCUTS, usePrefs } from "@/lib/prefs/store";
import { usePlayer, MAX_RATE, MIN_RATE } from "@/lib/player/store";

/**
 * Power-mode keyboard control.
 *
 * The three basics (space and the arrows) are handled by the player bar and
 * always available. Everything here is the extra layer power mode discloses —
 * transport keys borrowed from the conventions people already know from video
 * players, so there is nothing new to learn.
 */
export function KeyboardShortcuts() {
  const powerMode = usePrefs((s) => s.powerMode);
  const setShortcutsOpen = usePrefs((s) => s.setShortcutsOpen);

  useEffect(() => {
    if (!powerMode) return;

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      // Never steal a key from a text field, and leave browser and OS
      // combinations alone.
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      const player = usePlayer.getState();

      switch (event.key) {
        case "?":
          event.preventDefault();
          setShortcutsOpen(true);
          return;
        case "Escape":
          setShortcutsOpen(false);
          return;
      }

      // The rest only make sense with something loaded.
      if (!player.episode) return;

      switch (event.key.toLowerCase()) {
        case "k":
          event.preventDefault();
          player.toggle();
          break;
        case "j":
          event.preventDefault();
          player.skipBack();
          break;
        case "l":
          event.preventDefault();
          player.skipForward();
          break;
        case "m":
          event.preventDefault();
          player.toggleMute();
          break;
        case "n":
          event.preventDefault();
          player.setExpanded(!player.expanded);
          break;
        case "c":
          event.preventDefault();
          if (!player.expanded) player.setExpanded(true);
          player.setCaptionsOpen(!player.captionsOpen);
          break;
        case "0":
          event.preventDefault();
          player.setRate(1);
          break;
        case "+":
        case "=":
          event.preventDefault();
          player.setRate(Math.min(MAX_RATE, player.playbackRate + 0.1));
          break;
        case "-":
          event.preventDefault();
          player.setRate(Math.max(MIN_RATE, player.playbackRate - 0.1));
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [powerMode, setShortcutsOpen]);

  return <ShortcutsDialog />;
}

function ShortcutsDialog() {
  const open = usePrefs((s) => s.shortcutsOpen);
  const powerMode = usePrefs((s) => s.powerMode);
  const setShortcutsOpen = usePrefs((s) => s.setShortcutsOpen);

  if (!open) return null;

  const shortcuts = SHORTCUTS.filter((s) => powerMode || !s.powerOnly);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => setShortcutsOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-lifted)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold tracking-tight">Keyboard shortcuts</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              These work anywhere except inside a text field.
            </p>
          </div>
          <button
            onClick={() => setShortcutsOpen(false)}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <dl className="mt-5 space-y-2">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-center justify-between gap-4">
              <dt className="text-sm text-muted-foreground">{shortcut.description}</dt>
              <dd>
                <kbd className="rounded-md border border-border bg-surface-raised px-2 py-1 text-xs font-medium tabular-nums">
                  {shortcut.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>

        {!powerMode && (
          <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            Turn on Power user mode in Settings for transport keys, speed
            control and filters.
          </p>
        )}
      </div>
    </div>
  );
}
