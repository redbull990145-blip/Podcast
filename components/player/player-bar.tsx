"use client";

import Image from "next/image";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, X } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { press, pressPrimary, pressSubtle } from "@/lib/motion/gestures";
import { SpeedControl } from "./speed-control";
import { VolumeControl } from "./volume-control";
import { Scrubber } from "./scrubber";
import { SkipButton } from "./skip-button";
import { TransportIcon } from "./transport-icon";
import { formatDuration } from "@/lib/utils";

/*
 * Position is read in these two leaves rather than in PlayerBar itself.
 *
 * It changes about four times a second for as long as anything is playing, and
 * subscribing to it at the top would re-render the artwork, the title, all
 * three transport buttons and both popovers on every tick — for a number that
 * only two elements display.
 */
function BarScrubber() {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  return (
    <Scrubber
      currentTime={currentTime}
      duration={duration}
      onSeek={seek}
      trackClassName="rounded-none"
    />
  );
}

function BarTimings() {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {formatDuration(currentTime)}
      <span className="mx-1 text-subtle-foreground">/</span>
      {formatDuration(duration)}
    </span>
  );
}

/**
 * Persistent player, docked above the mobile tab bar and along the bottom on
 * desktop. Hidden entirely until something is loaded so it never takes space
 * from an empty library.
 */
export function PlayerBar() {
  const episode = usePlayer((s) => s.episode);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isBuffering = usePlayer((s) => s.isBuffering);
  const error = usePlayer((s) => s.error);
  const skipForwardSeconds = usePlayer((s) => s.skipForwardSeconds);
  const skipBackSeconds = usePlayer((s) => s.skipBackSeconds);

  const toggle = usePlayer((s) => s.toggle);
  const retry = usePlayer((s) => s.retry);
  const skipForward = usePlayer((s) => s.skipForward);
  const skipBack = usePlayer((s) => s.skipBack);
  const stop = usePlayer((s) => s.stop);
  const setExpanded = usePlayer((s) => s.setExpanded);

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

  return (
    <AnimatePresence>
      {episode && (
        <motion.div
          key="player-bar"
          // The bar rises into place the first time something is played and
          // drops away when the player is closed, instead of simply existing.
          //
          // Arriving gets the spring; leaving gets a tween. A spring's tail is
          // asymptotic, so the same curve run backwards measured 600ms before
          // the element could unmount — long after it had visually gone. When
          // someone closes the player they want it gone, not eased away.
          initial={{ y: "110%" }}
          animate={{ y: 0, transition: SPRING.sheet }}
          exit={{ y: "110%", transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } }}
          className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 border-t border-border bg-surface/95 backdrop-blur-xl lg:bottom-0"
        >
          {/*
            Height is animated here, which the rest of the app avoids — but an
            error banner appearing has to push the bar's own content down, and
            there is no transform that moves a sibling. It happens at most once
            per failure, on two elements, so the layout pass is affordable.
          */}
          <AnimatePresence initial={false}>
            {error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={TWEEN.normal}
                className="overflow-hidden bg-danger/10 px-4 py-2 text-xs text-danger"
              >
                <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
                  <span>{error}</span>
                  {/*
                    Most load failures are temporary — a dropped CDN request, a
                    momentary DNS failure — and the automatic retry has already
                    been spent by the time this is on screen. Without this, the
                    only way back is to find the episode and start it again.
                  */}
                  <motion.button
                    {...pressSubtle}
                    onClick={retry}
                    className="shrink-0 rounded-full bg-danger/15 px-2.5 py-1 font-medium hover:bg-danger/25"
                  >
                    Try again
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scrubber sits flush along the top edge, full width, easy to hit. */}
          <BarScrubber />

          <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-5">
            {/*
              Artwork and titles are one target that opens Now Playing, the way
              every native player behaves. Deep links to the episode and show
              pages live inside Now Playing rather than competing for the same
              few pixels here.
            */}
            <motion.button
              whileTap={{ scale: 0.985 }}
              transition={SPRING.snappy}
              onClick={() => setExpanded(true)}
              aria-label={`Open Now Playing for ${episode.title}`}
              className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left sm:gap-4"
            >
              <span className="relative shrink-0">
                {episode.artworkUrl ? (
                  <Image
                    src={episode.artworkUrl}
                    alt=""
                    width={96}
                    height={96}
                    sizes="48px"
                    className="size-10 rounded-lg object-cover sm:size-12"
                  />
                ) : (
                  <span className="block size-10 rounded-lg bg-accent-subtle sm:size-12" />
                )}
                <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                  <ChevronUp className="size-5 text-white" />
                </span>
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {episode.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {episode.podcastTitle}
                </span>
              </span>
            </motion.button>

            <div className="flex items-center gap-1 sm:gap-2">
              <span className="hidden sm:block">
                <SkipButton
                  direction="back"
                  seconds={skipBackSeconds}
                  onClick={skipBack}
                />
              </span>

              <motion.button
                {...pressPrimary}
                onClick={toggle}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="grid size-10 place-items-center rounded-full bg-accent text-accent-foreground"
              >
                <TransportIcon
                  isPlaying={isPlaying}
                  isBuffering={isBuffering}
                  className="size-5"
                />
              </motion.button>

              <SkipButton
                direction="forward"
                seconds={skipForwardSeconds}
                onClick={skipForward}
              />
            </div>

            <div className="hidden items-center gap-3 sm:flex">
              <BarTimings />

              <SpeedControl />

              <VolumeControl />

              <motion.button
                {...press}
                onClick={stop}
                aria-label="Close player"
                className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-4" />
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
