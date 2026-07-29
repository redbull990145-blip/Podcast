"use client";

import dynamic from "next/dynamic";
import { usePlayer } from "@/lib/player/store";

/**
 * Loads Now Playing only once someone opens it.
 *
 * It pulls in the captions panel, palette extraction and three popovers, none of
 * which the app needs to render a page — so keeping it out of the initial bundle
 * is worth the one-frame delay on first open.
 */
const NowPlaying = dynamic(
  () => import("./now-playing").then((m) => m.NowPlaying),
  { ssr: false },
);

export function NowPlayingHost() {
  const expanded = usePlayer((s) => s.expanded);
  if (!expanded) return null;
  return <NowPlaying />;
}
