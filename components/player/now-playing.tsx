"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Captions, ChevronDown } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import {
  extractArtworkPalette,
  FALLBACK_PALETTE,
  type ArtworkPalette,
} from "@/lib/player/artwork-palette";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { press, pressPrimary } from "@/lib/motion/gestures";
import { sheet } from "@/lib/motion/variants";
import { Scrubber } from "./scrubber";
import { SkipButton } from "./skip-button";
import { SpeedControl } from "./speed-control";
import { VolumeControl } from "./volume-control";
import { SleepTimer } from "./sleep-timer";
import { CaptionsPanel } from "./captions-panel";
import { TransportIcon } from "./transport-icon";
import { cn, formatDuration } from "@/lib/utils";

/**
 * Seek bar and timings.
 *
 * Split out into its own component so that the position — which updates about
 * four times a second for as long as anything is playing — re-renders only
 * these two lines. Read at the top of Now Playing instead, every tick would
 * re-render the artwork, the transport, the popovers and, expensively, the
 * whole transcript, which measured 34 long tasks and 112ms of blocked main
 * thread per second with the captions panel open.
 */
function PositionBar() {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const remaining = duration > 0 ? duration - currentTime : 0;

  return (
    <div className="mt-5">
      <Scrubber
        currentTime={currentTime}
        duration={duration}
        onSeek={seek}
        tone="light"
        trackClassName="h-1.5"
      />

      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-white/55">
        <span>{formatDuration(currentTime)}</span>
        <span>−{formatDuration(remaining)}</span>
      </div>
    </div>
  );
}

/**
 * Full-screen Now Playing.
 *
 * The backdrop is built from the artwork's own colours, which is what makes a
 * player feel like it belongs to the show rather than to the app. It is always
 * resolved to a dark gradient regardless of the source image: a light palette
 * would mean recomputing contrast for every control on every episode, and one
 * bright cover would be enough to make the text unreadable.
 *
 * Mounted only while open — the host above owns that decision so the sheet can
 * animate out — so this component can treat its own mount as "opening".
 */
export function NowPlaying() {
  const episode = usePlayer((s) => s.episode);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const error = usePlayer((s) => s.error);
  const captionsOpen = usePlayer((s) => s.captionsOpen);
  const skipForwardSeconds = usePlayer((s) => s.skipForwardSeconds);
  const skipBackSeconds = usePlayer((s) => s.skipBackSeconds);

  const toggle = usePlayer((s) => s.toggle);
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
  }, [setExpanded]);

  if (!episode) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`Now playing: ${episode.title}`}
      variants={sheet}
      initial="hidden"
      animate="visible"
      exit="exit"
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
        <motion.button
          {...press}
          onClick={() => setExpanded(false)}
          aria-label="Close Now Playing"
          className="grid size-10 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/15 hover:text-white"
        >
          <ChevronDown className="size-6" />
        </motion.button>

        <Link
          href={`/podcast/${episode.podcastId}`}
          onClick={() => setExpanded(false)}
          className="max-w-[60%] truncate text-xs font-medium uppercase tracking-wide text-white/60 transition-colors hover:text-white"
        >
          {episode.podcastTitle}
        </Link>

        <motion.button
          {...press}
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
        </motion.button>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-8">
        {/*
          `wait` rather than a crossfade: these are flex children, and letting
          both exist for a moment would make the panel jump to fit two.
        */}
        <AnimatePresence mode="wait" initial={false}>
          {captionsOpen ? (
            <motion.div
              key="captions"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={TWEEN.fast}
              className="flex min-h-0 flex-1 flex-col"
            >
              <CaptionsPanel episodeId={episode.id} />
            </motion.div>
          ) : (
            <motion.div
              key="artwork"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={TWEEN.fast}
              className="grid flex-1 place-items-center py-4"
            >
              {/*
                The cover eases down a couple of percent when paused, the way
                Apple Music does. It is the clearest possible signal of playback
                state and it costs one composited transform.
              */}
              <motion.div
                animate={{ scale: isPlaying ? 1 : 0.94 }}
                transition={SPRING.sheet}
                className="w-[min(78vw,380px)]"
              >
                {artworkUrl ? (
                  <Image
                    src={artworkUrl}
                    alt=""
                    width={640}
                    height={640}
                    sizes="(max-width: 640px) 78vw, 380px"
                    priority
                    className="aspect-square w-full rounded-2xl object-cover shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
                  />
                ) : (
                  <div className="aspect-square w-full rounded-2xl bg-white/10" />
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

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

          <AnimatePresence>
            {error && (
              <motion.p
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={TWEEN.normal}
                className="mt-2 text-xs text-red-300"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {/* --- scrubber --- */}
          <PositionBar />

          {/* --- transport --- */}
          <div className="mt-4 flex items-center justify-center gap-6 sm:gap-8">
            <SkipButton
              direction="back"
              seconds={skipBackSeconds}
              onClick={skipBack}
              size="lg"
            />

            <motion.button
              {...pressPrimary}
              onClick={toggle}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="grid size-16 place-items-center rounded-full bg-white text-neutral-900"
            >
              <TransportIcon
                isPlaying={isPlaying}
                isBuffering={isBuffering}
                className="size-7"
              />
            </motion.button>

            <SkipButton
              direction="forward"
              seconds={skipForwardSeconds}
              onClick={skipForward}
              size="lg"
            />
          </div>

          {/* --- secondary controls --- */}
          <div className="mt-5 flex items-center justify-between gap-4">
            <SpeedControl tone="light" />
            <VolumeControl layout="inline" className="max-w-56 flex-1 text-white" />
            <SleepTimer tone="light" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
