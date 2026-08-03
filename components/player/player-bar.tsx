"use client";

import Image from "next/image";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, X } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import { DURATION, SPRING, TWEEN } from "@/lib/motion/config";
import { press, pressPrimary, pressSubtle } from "@/lib/motion/gestures";
import { SpeedControl } from "./speed-control";
import { VolumeControl } from "./volume-control";
import { Scrubber } from "./scrubber";
import { SkipButton } from "./skip-button";
import { TransportIcon } from "./transport-icon";
import { cn, formatDuration, formatDurationLong } from "@/lib/utils";

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
    <span className="shrink-0 text-xs tabular-nums text-muted">
      {formatDuration(currentTime)}
      <span className="mx-1 text-faint">/</span>
      {formatDuration(duration)}
    </span>
  );
}

/**
 * "34 min left" — what the phone's mini player says under the title.
 *
 * The show's name is what the docked bar shows there, and it is the right
 * choice on a bar wide enough to carry the episode title in full. In a 382px
 * pill the title is truncated anyway, so a second truncated line naming the
 * show adds nothing you could not already infer, where the time left is the one
 * fact that changes and the only reason to glance at the player at all.
 */
function MiniRemaining() {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const remaining = duration > 0 ? duration - currentTime : 0;
  return <>{remaining > 0 ? `${formatDurationLong(remaining)} left` : "Nearly done"}</>;
}

/**
 * Hairline progress inside the mini player, read-only.
 *
 * The docked bar puts a full-width `Scrubber` flush along its top edge, which
 * is a control — you can drag it. This is not one, and deliberately: it is
 * 3px tall inside a floating pill whose whole surface is already a tap target
 * that opens Now Playing, so a draggable region here would mean a third of the
 * pill's height silently doing something other than what the rest of it does.
 * Seeking on a phone happens on the sheet, where the bar is 6px with a knob.
 */
function MiniProgress() {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const fraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <span
      aria-hidden
      className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-track lg:hidden"
    >
      {/* Springs rather than steps: position republishes about four times a
          second, and a fill that only moved when the number did would visibly
          tick. See SPRING.progress. */}
      <motion.span
        animate={{ scaleX: fraction }}
        transition={SPRING.progress}
        className="block h-full origin-left rounded-full bg-accent"
      />
    </span>
  );
}

/**
 * Transcript and Ask, as chips rather than icons.
 *
 * Both open a panel that most people have never seen, and neither has an icon
 * anyone would recognise cold — "captions" reads as subtitles, and there is no
 * conventional glyph at all for asking an episode a question. Words cost about
 * the same width here and remove the guess.
 */
function PanelChip({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      {...pressSubtle}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-8 shrink-0 rounded-[10px] border px-3 text-xs font-medium transition-colors",
        active
          ? "border-accent bg-accent-subtle text-accent"
          : "border-border-input bg-background text-ink-4 hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </motion.button>
  );
}

/**
 * Persistent player: a floating glass pill on a phone, a docked bar on desktop.
 * Hidden entirely until something is loaded so it never takes space from an
 * empty library.
 *
 * On a phone it is the mate to `MobileTabBar` — the same material, the same
 * 10px inset, at the other end of the screen — and it carries only what one
 * hand needs mid-episode: what is playing, how much is left, and pause. Skip,
 * speed, volume, sleep and the two panels all live one tap in, on the Now
 * Playing sheet, where there is room to hit them.
 *
 * One element serves both, moved by `lg:` utilities and by `.glass-to-lg`
 * unsetting the glass at that width. See the note on that class for why it is
 * not two components.
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
  const captionsOpen = usePlayer((s) => s.captionsOpen);
  const askOpen = usePlayer((s) => s.askOpen);
  const setCaptionsOpen = usePlayer((s) => s.setCaptionsOpen);
  const setAskOpen = usePlayer((s) => s.setAskOpen);

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
          exit={{ y: "110%", transition: { duration: DURATION.normal, ease: [0.4, 0, 1, 1] } }}
          className={cn(
            "fluid-glass glass-to-lg fixed z-40",
            "inset-x-2.5 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]",
            /*
              Clips the error banner to the pill's own corners. Released at lg,
              where the speed and volume popovers open upward out of the bar and
              a clip would cut them off at the top edge.
            */
            "overflow-hidden lg:overflow-visible",
            "lg:inset-x-0 lg:bottom-0 lg:border-t lg:border-border lg:bg-[var(--bar-bg)] lg:backdrop-blur-xl",
          )}
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

          {/*
            Scrubber sits flush along the top edge, full width, easy to hit.
            The phone gets `MiniProgress` inside the title block instead — see
            the note there for why the pill has no draggable region.
          */}
          <span className="hidden lg:block">
            <BarScrubber />
          </span>

          <div className="flex items-center gap-3 p-2.5 lg:gap-4.5 lg:px-7 lg:py-2.5">
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
              className="group flex min-w-0 flex-1 items-center gap-3 rounded-app text-left lg:max-w-[340px] lg:gap-3.5"
            >
              <span className="relative shrink-0">
                {episode.artworkUrl ? (
                  <Image
                    src={episode.artworkUrl}
                    alt=""
                    width={96}
                    height={96}
                    sizes="48px"
                    className="size-[46px] rounded-app object-cover shadow-[0_4px_12px_rgb(34_32_29_/_0.16)] lg:size-12"
                  />
                ) : (
                  <span className="block size-[46px] rounded-app bg-accent-subtle lg:size-12" />
                )}
                <span className="absolute inset-0 grid place-items-center rounded-app bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                  <ChevronUp className="size-5 text-white" />
                </span>
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold lg:text-[13.5px]">
                  {episode.title}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted lg:text-xs lg:text-subtle-2">
                  <span className="lg:hidden">
                    <MiniRemaining />
                  </span>
                  <span className="hidden lg:inline">{episode.podcastTitle}</span>
                </span>
                <MiniProgress />
              </span>
            </motion.button>

            <div className="flex items-center gap-1 lg:gap-2.5">
              <span className="hidden lg:block">
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
                className="grid size-[46px] shrink-0 place-items-center rounded-full bg-accent text-accent-foreground shadow-[var(--shadow-accent)]"
              >
                <TransportIcon
                  isPlaying={isPlaying}
                  isBuffering={isBuffering}
                  className="size-5"
                />
              </motion.button>

              {/*
                Skip forward is desktop-only now. On a phone the pill holds
                artwork, two lines of text and pause at 44px each; a fourth
                target would take the title down to about 120px, and skipping is
                one tap away on the sheet where it is a 52px control.
              */}
              <span className="hidden lg:block">
                <SkipButton
                  direction="forward"
                  seconds={skipForwardSeconds}
                  onClick={skipForward}
                />
              </span>
            </div>

            <span className="hidden lg:block">
              <BarTimings />
            </span>

            {/* Pushes the secondary controls to the far edge, which is what
                keeps the transport near the artwork it belongs to rather than
                floating in the middle of a wide bar. */}
            <div className="hidden flex-1 lg:block" />

            <div className="hidden items-center gap-2 lg:flex">
              <PanelChip
                onClick={() => {
                  setExpanded(true);
                  setCaptionsOpen(!captionsOpen);
                }}
                active={captionsOpen}
              >
                Transcript
              </PanelChip>

              <PanelChip
                onClick={() => {
                  setExpanded(true);
                  setAskOpen(!askOpen);
                }}
                active={askOpen}
              >
                Ask
              </PanelChip>

              <SpeedControl />

              <VolumeControl />

              <motion.button
                {...press}
                onClick={stop}
                aria-label="Close player"
                className="grid size-8 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-surface-hover hover:text-foreground"
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
