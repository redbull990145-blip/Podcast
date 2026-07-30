"use client";

import dynamic from "next/dynamic";
import { AnimatePresence } from "motion/react";
import { usePlayer } from "@/lib/player/store";

/**
 * Loads Now Playing only once someone opens it.
 *
 * It pulls in the captions panel, palette extraction and three popovers, none of
 * which the app needs to render a page — so keeping it out of the initial bundle
 * is worth the one-frame delay on first open.
 *
 * AnimatePresence lives here rather than inside Now Playing because a component
 * cannot animate its own unmount: by the time it decides to stop rendering, it
 * is already gone. Holding the decision one level up is what lets the sheet
 * slide back down instead of vanishing.
 */
const NowPlaying = dynamic(
  () => import("./now-playing").then((m) => m.NowPlaying),
  { ssr: false },
);

export function NowPlayingHost() {
  const expanded = usePlayer((s) => s.expanded);

  return (
    <AnimatePresence>{expanded && <NowPlaying key="now-playing" />}</AnimatePresence>
  );
}
