"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePrefs } from "@/lib/prefs/store";

/**
 * Keeps the palette out of the initial bundle.
 *
 * The palette pulls in cmdk and Radix's dialog, and it is mounted in the shell
 * of every authenticated page — so without this, every first paint in the app
 * pays for a surface that most sessions never open. Gating the dynamic import
 * behind the open flag means the chunk is requested by the keystroke that
 * opens it, and the request overlaps the dialog's own entrance animation.
 *
 * The same pattern, and the same reasoning, as `now-playing-host.tsx`.
 *
 * `ssr: false` because there is nothing to server-render: it is closed on
 * first paint by definition, and the prefs store it reads is deliberately
 * unhydrated until after mount so that SSR and the client agree.
 */
const CommandPalette = dynamic(
  () => import("./command-palette").then((m) => m.CommandPalette),
  { ssr: false },
);

export function CommandPaletteHost() {
  const open = usePrefs((s) => s.paletteOpen);

  /*
   * Stays mounted once it has been opened for the first time.
   *
   * Unmounting on close would tear the component down mid-exit-animation — the
   * palette would disappear rather than close. `AnimatePresence` inside it owns
   * the exit; this flag only decides whether the code has been fetched at all,
   * and so it never goes back to false.
   */
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  if (!everOpened) return null;
  return <CommandPalette />;
}
