"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import { SpeedControl } from "./speed-control";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Persistent player, docked above the mobile tab bar and along the bottom on
 * desktop. Hidden entirely until something is loaded so it never takes space
 * from an empty library.
 */
export function PlayerBar() {
  const episode = usePlayer((s) => s.episode);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const error = usePlayer((s) => s.error);
  const muted = usePlayer((s) => s.muted);
  const skipForwardSeconds = usePlayer((s) => s.skipForwardSeconds);
  const skipBackSeconds = usePlayer((s) => s.skipBackSeconds);

  const toggle = usePlayer((s) => s.toggle);
  const seek = usePlayer((s) => s.seek);
  const skipForward = usePlayer((s) => s.skipForward);
  const skipBack = usePlayer((s) => s.skipBack);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const stop = usePlayer((s) => s.stop);

  // While dragging the scrubber, show the dragged value rather than fighting
  // the timeupdate events streaming in underneath.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const displayTime = scrubbing ?? currentTime;

  // Space toggles playback anywhere that isn't a text field.
  useEffect(() => {
    if (!episode) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (typing) return;

      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        skipForward();
      } else if (e.key === "ArrowLeft" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        skipBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [episode, toggle, skipForward, skipBack]);

  if (!episode) return null;

  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-surface/95 backdrop-blur-xl lg:bottom-0">
      {error && (
        <p role="alert" className="bg-danger/10 px-4 py-2 text-center text-xs text-danger">
          {error}
        </p>
      )}

      {/* Scrubber sits flush along the top edge, full width, easy to hit. */}
      <div className="group relative h-1 w-full bg-border">
        <div
          className="h-full bg-accent transition-[width] duration-100"
          style={{ width: `${progress}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={displayTime}
          aria-label="Seek"
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onPointerUp={() => {
            if (scrubbing != null) seek(scrubbing);
            setScrubbing(null);
          }}
          onKeyUp={() => {
            if (scrubbing != null) seek(scrubbing);
            setScrubbing(null);
          }}
          className="absolute inset-0 h-4 w-full -translate-y-1.5 cursor-pointer opacity-0"
        />
      </div>

      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-5">
        {episode.artworkUrl && (
          <Image
            src={episode.artworkUrl}
            alt=""
            width={48}
            height={48}
            unoptimized
            className="size-10 shrink-0 rounded-lg object-cover sm:size-12"
          />
        )}

        <div className="min-w-0 flex-1">
          <Link
            href={`/episode/${episode.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {episode.title}
          </Link>
          <Link
            href={`/podcast/${episode.podcastId}`}
            className="block truncate text-xs text-muted-foreground hover:underline"
          >
            {episode.podcastTitle}
          </Link>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={skipBack}
            aria-label={`Back ${skipBackSeconds} seconds`}
            title={`Back ${skipBackSeconds}s`}
            className="relative hidden size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground sm:grid"
          >
            <RotateCcw className="size-5" strokeWidth={1.75} />
            <span className="absolute text-[8px] font-bold tabular-nums">
              {skipBackSeconds}
            </span>
          </button>

          <button
            onClick={toggle}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="grid size-10 place-items-center rounded-full bg-accent text-accent-foreground transition-transform active:scale-95"
          >
            {isBuffering ? (
              <Loader2 className="size-5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 translate-x-px fill-current" />
            )}
          </button>

          <button
            onClick={skipForward}
            aria-label={`Forward ${skipForwardSeconds} seconds`}
            title={`Forward ${skipForwardSeconds}s`}
            className="relative grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <RotateCw className="size-5" strokeWidth={1.75} />
            <span className="absolute text-[8px] font-bold tabular-nums">
              {skipForwardSeconds}
            </span>
          </button>
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDuration(displayTime)}
            <span className="mx-1 text-subtle-foreground">/</span>
            {formatDuration(duration)}
          </span>

          <SpeedControl />

          <button
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className={cn(
              "grid size-8 place-items-center rounded-full transition-colors hover:bg-surface-hover",
              muted ? "text-accent" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>

          <button
            onClick={stop}
            aria-label="Close player"
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
