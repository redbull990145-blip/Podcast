"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Captions,
  ChevronDown,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import {
  extractArtworkPalette,
  FALLBACK_PALETTE,
  type ArtworkPalette,
} from "@/lib/player/artwork-palette";
import { Scrubber } from "./scrubber";
import { SpeedControl } from "./speed-control";
import { VolumeControl } from "./volume-control";
import { SleepTimer } from "./sleep-timer";
import { CaptionsPanel } from "./captions-panel";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Full-screen Now Playing.
 *
 * The backdrop is built from the artwork's own colours, which is what makes a
 * player feel like it belongs to the show rather than to the app. It is always
 * resolved to a dark gradient regardless of the source image: a light palette
 * would mean recomputing contrast for every control on every episode, and one
 * bright cover would be enough to make the text unreadable.
 */
export function NowPlaying() {
  const episode = usePlayer((s) => s.episode);
  const expanded = usePlayer((s) => s.expanded);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const error = usePlayer((s) => s.error);
  const captionsOpen = usePlayer((s) => s.captionsOpen);
  const skipForwardSeconds = usePlayer((s) => s.skipForwardSeconds);
  const skipBackSeconds = usePlayer((s) => s.skipBackSeconds);

  const toggle = usePlayer((s) => s.toggle);
  const seek = usePlayer((s) => s.seek);
  const skipForward = usePlayer((s) => s.skipForward);
  const skipBack = usePlayer((s) => s.skipBack);
  const setExpanded = usePlayer((s) => s.setExpanded);
  const setCaptionsOpen = usePlayer((s) => s.setCaptionsOpen);

  const [palette, setPalette] = useState<ArtworkPalette>(FALLBACK_PALETTE);

  const artworkUrl = episode?.artworkUrl ?? null;

  useEffect(() => {
    let cancelled = false;
    setPalette(FALLBACK_PALETTE);
    void extractArtworkPalette(artworkUrl).then((result) => {
      if (!cancelled && result) setPalette(result);
    });
    return () => {
      cancelled = true;
    };
  }, [artworkUrl]);

  // Escape closes, and the page behind must not scroll while this is over it.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded, setExpanded]);

  if (!episode || !expanded) return null;

  const remaining = duration > 0 ? duration - currentTime : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${episode.title}`}
      className="fixed inset-0 z-[60] flex flex-col text-white"
      style={{
        // color-mix does the darkening, so the gradient stays tied to the real
        // artwork colours instead of a hand-tuned approximation of them.
        background: `linear-gradient(180deg,
          color-mix(in oklab, ${palette.glow} 62%, #0d0d12) 0%,
          color-mix(in oklab, ${palette.glow} 34%, #0a0a0f) 32%,
          color-mix(in oklab, ${palette.base} 20%, #08080c) 68%,
          #07070b 100%)`,
      }}
    >
      <header className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
        <button
          onClick={() => setExpanded(false)}
          aria-label="Close Now Playing"
          className="grid size-10 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/15 hover:text-white"
        >
          <ChevronDown className="size-6" />
        </button>

        <Link
          href={`/podcast/${episode.podcastId}`}
          onClick={() => setExpanded(false)}
          className="max-w-[60%] truncate text-xs font-medium uppercase tracking-wide text-white/60 transition-colors hover:text-white"
        >
          {episode.podcastTitle}
        </Link>

        <button
          onClick={() => setCaptionsOpen(!captionsOpen)}
          aria-pressed={captionsOpen}
          aria-label={captionsOpen ? "Hide captions" : "Show captions"}
          className={cn(
            "grid size-10 place-items-center rounded-full transition-colors",
            captionsOpen
              ? "bg-white/25 text-white"
              : "text-white/75 hover:bg-white/15 hover:text-white",
          )}
        >
          <Captions className="size-5" />
        </button>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-8">
        {captionsOpen ? (
          <CaptionsPanel episodeId={episode.id} />
        ) : (
          <div className="grid flex-1 place-items-center py-4">
            {artworkUrl ? (
              <Image
                src={artworkUrl}
                alt=""
                width={640}
                height={640}
                sizes="(max-width: 640px) 78vw, 380px"
                priority
                className="aspect-square w-[min(78vw,380px)] rounded-2xl object-cover shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
              />
            ) : (
              <div className="aspect-square w-[min(78vw,380px)] rounded-2xl bg-white/10" />
            )}
          </div>
        )}

        <div className="shrink-0 pt-4">
          <h1 className="text-balance text-lg font-semibold leading-snug">
            <Link
              href={`/episode/${episode.id}`}
              onClick={() => setExpanded(false)}
              className="transition-opacity hover:opacity-80"
            >
              {episode.title}
            </Link>
          </h1>

          {error && (
            <p role="alert" className="mt-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {/* --- scrubber --- */}
          <div className="mt-5">
            <Scrubber
              currentTime={currentTime}
              duration={duration}
              onSeek={seek}
              trackClassName="h-1.5 bg-white/20"
              fillClassName="bg-white"
            />

            <div className="mt-2 flex justify-between text-[11px] tabular-nums text-white/55">
              <span>{formatDuration(currentTime)}</span>
              <span>−{formatDuration(remaining)}</span>
            </div>
          </div>

          {/* --- transport --- */}
          <div className="mt-4 flex items-center justify-center gap-6 sm:gap-8">
            <button
              onClick={skipBack}
              aria-label={`Back ${skipBackSeconds} seconds`}
              className="relative grid size-12 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            >
              <RotateCcw className="size-8" strokeWidth={1.5} />
              <span className="absolute text-[9px] font-bold tabular-nums">
                {skipBackSeconds}
              </span>
            </button>

            <button
              onClick={toggle}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="grid size-16 place-items-center rounded-full bg-white text-neutral-900 transition-transform active:scale-95"
            >
              {isBuffering ? (
                <Loader2 className="size-7 animate-spin" />
              ) : isPlaying ? (
                <Pause className="size-7 fill-current" />
              ) : (
                <Play className="size-7 translate-x-0.5 fill-current" />
              )}
            </button>

            <button
              onClick={skipForward}
              aria-label={`Forward ${skipForwardSeconds} seconds`}
              className="relative grid size-12 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white"
            >
              <RotateCw className="size-8" strokeWidth={1.5} />
              <span className="absolute text-[9px] font-bold tabular-nums">
                {skipForwardSeconds}
              </span>
            </button>
          </div>

          {/* --- secondary controls --- */}
          <div className="mt-5 flex items-center justify-between gap-4">
            <SpeedControl tone="light" />
            <VolumeControl layout="inline" className="max-w-56 flex-1 text-white" />
            <SleepTimer tone="light" />
          </div>
        </div>
      </div>
    </div>
  );
}
