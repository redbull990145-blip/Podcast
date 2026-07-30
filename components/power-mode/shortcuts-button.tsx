"use client";

import { Keyboard } from "lucide-react";
import { usePrefs } from "@/lib/prefs/store";

/** Opens the shortcut reference for anyone who would never think to press "?". */
export function ShortcutsButton() {
  const setShortcutsOpen = usePrefs((s) => s.setShortcutsOpen);

  return (
    <button
      onClick={() => setShortcutsOpen(true)}
      className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-app)] border border-border bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-hover"
    >
      <Keyboard className="size-4" />
      View shortcuts
    </button>
  );
}
