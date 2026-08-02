"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import { usePrefs } from "@/lib/prefs/store";
import {
  extractArtworkPalette,
  FALLBACK_PALETTE,
  type ArtworkPalette,
} from "@/lib/player/artwork-palette";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { press, pressPrimary } from "@/lib/motion/gestures";
import { sheet } from "@/lib/motion/variants";
import { chapterTicks } from "@/lib/player/chapters";
import { AnimatedArtwork } from "@/components/artwork/animated-artwork";
import { ChapterStrip, useChapters } from "./chapter-strip";
import { Scrubber } from "./scrubber";
import { SkipButton } from "./skip-button";
import { SpeedControl } from "./speed-control";
import { VolumeControl } from "./volume-control";
import { SleepTimer } from "./sleep-timer";
import { CaptionsPanel } from "./captions-panel";
import { AskPanel } from "./ask-panel";
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
function PositionBar({ episodeId }: { episodeId: string }) {
  const currentTime = usePlayer((s) => s.currentTime);
  const duration = usePlayer((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const remaining = duration > 0 ? duration - currentTime : 0;

  /*
   * Chapter marks on the seek bar. The query is shared with the strip above,
   * so this is a cache read rather than a second request, and `useMemo` keeps
   * the array identity stable across the four position updates a second — a
   * fresh array each tick would re-render every mark for nothing.
   */
  const { data } = useChapters(episodeId);
  const ticks = useMemo(
    () => chapterTicks(data?.chapters ?? [], duration),
    [data?.chapters, duration],
  );

  return (
    <div className="mt-5">
      <Scrubber
        currentTime={currentTime}
        duration={duration}
        onSeek={seek}
        tone="light"
        trackClassName="h-1.5"
        ticks={ticks}
      />

      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-white/55">
        <span>{formatDuration(currentTime)}</span>
        <span>−{formatDuration(remaining)}</span>
      </div>
    </div>
  );
}

/**
 * Ambient backdrop, built from `palette.mesh` — see artwork-palette.ts for how
 * those colours are chosen and toned.
 *
 * A single vertical fade of one or two colours is what a colour picker looks
 * like, not what a premium player looks like: Apple Music and Spotify both
 * scatter several soft, blurred colour fields across the screen rather than
 * one directional gradient, which is what actually reads as depth rather than
 * as a swatch. Three overlapping radial fields do that here, positioned
 * off-centre and asymmetrically so the eye reads it as light falling on a
 * surface rather than as a shape.
 *
 * The vignette is listed first — CSS paints earlier background layers on top
 * of later ones — so it sits above the colour fields and guarantees the
 * control area at the bottom is always on near-black, whatever the artwork's
 * colours are. Without it, a bright mesh colour landing near the bottom could
 * make the transport controls hard to read.
 */
function meshBackground(mesh: string[]): string {
  const [first, second, third] = mesh;

  return [
    `radial-gradient(115% 85% at 14% 6%, ${first} 0%, transparent 58%)`,
    `radial-gradient(105% 80% at 90% 20%, ${second ?? first} 0%, transparent 60%)`,
    `radial-gradient(125% 90% at 46% 100%, ${third ?? second ?? first} 0%, transparent 64%)`,
  ].join(", ");
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
  const askOpen = usePlayer((s) => s.askOpen);
  const skipForwardSeconds = usePlayer((s) => s.skipForwardSeconds);
  const skipBackSeconds = usePlayer((s) => s.skipBackSeconds);

  const toggle = usePlayer((s) => s.toggle);
  const skipForward = usePlayer((s) => s.skipForward);
  const skipBack = usePlayer((s) => s.skipBack);
  const setExpanded = usePlayer((s) => s.setExpanded);
  const setCaptionsOpen = usePlayer((s) => s.setCaptionsOpen);
  const setAskOpen = usePlayer((s) => s.setAskOpen);

  const panelOpen = captionsOpen || askOpen;

  const [palette, setPalette] = useState<ArtworkPalette>(FALLBACK_PALETTE);

  /*
   * The backdrop drifts under the same preference that governs the artwork —
   * they are one effect as far as anyone looking at the screen is concerned,
   * and splitting them into two switches would mean explaining a distinction
   * that only exists in the code. "Off" stops both.
   */
  const artworkMotion = usePrefs((s) => s.artworkMotion);
  const reducedMotion = useReducedMotion();
  const drifting = artworkMotion !== "off" && !reducedMotion;

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
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-[#06060a] text-white"
    >
      {/*
        The colour fields, on their own layer so they can move.

        Inset well past every edge and blurred hard: the layer drifts a couple
        of percent, and without the overhang that movement would drag the
        gradient's own boundary into view along an edge. See
        `.now-playing-drift` in globals.css for why it moves at all.
      */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-[12%] -z-10 blur-[46px]",
          drifting && "now-playing-drift",
        )}
        style={{ backgroundImage: meshBackground(palette.mesh) }}
      />

      {/*
        Vignette, deliberately *not* on the drifting layer. Its job is to
        guarantee the controls at the bottom sit on near-black whatever colours
        the artwork produced, and a vignette that wandered would stop
        guaranteeing it.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(3,3,4,0.3)_0%,rgba(3,3,4,0.1)_38%,rgba(3,3,4,0.76)_78%,#000_100%)]"
      />

      {/*
        Purely decorative texture sitting over the gradient and under the
        header/content — see `.now-playing-grain` in globals.css. `-z-10`
        matters: an absolutely positioned box otherwise paints above static
        siblings regardless of DOM order, which would put the grain over the
        controls instead of behind them.
      */}
      <div aria-hidden className="now-playing-grain pointer-events-none absolute inset-0 -z-10" />

      <header className="flex items-center justify-between gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-7">
        <motion.button
          {...press}
          onClick={() => setExpanded(false)}
          aria-label="Close Now Playing"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/85 transition-colors hover:bg-white/20 hover:text-white"
        >
          <ChevronDown className="size-5" />
        </motion.button>

        <Link
          href={`/podcast/${episode.podcastId}`}
          onClick={() => setExpanded(false)}
          className="min-w-0 truncate text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/60 transition-colors hover:text-white"
        >
          {episode.podcastTitle}
        </Link>

        <ViewSwitch
          view={captionsOpen ? "transcript" : askOpen ? "ask" : "artwork"}
          onChange={(next) => {
            setCaptionsOpen(next === "transcript");
            setAskOpen(next === "ask");
          }}
        />
      </header>

      {/*
        Below lg the panel takes the artwork's place above the controls; from lg
        it sits beside them in its own column. The transcript is set very large
        — see .caption-line__text — so on a phone it has to have the full width
        or it is not worth showing at all.

        Everything below renders each expensive child exactly once. The obvious
        way to build the two layouts is a mobile copy and a desktop copy behind
        `lg:hidden` / `hidden lg:flex`, and it is wrong twice over: `display:
        none` hides an element without unmounting it, so both copies stay live —
        two transcript virtual lists, two ResizeObservers, two animation frame
        loops — and the karaoke fill locates the line it is painting with
        `document.querySelector("[data-caption-active]")`, which finds whichever
        copy comes first in the document. On a desktop that is the hidden one,
        so the fill was being written to an invisible panel and the visible
        transcript never lit up. One instance, moved by `order`, fixes both.
      */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-5 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "sm:px-8 lg:flex-row lg:items-stretch lg:gap-10 lg:px-10 xl:gap-14 xl:px-16 2xl:px-24",
        )}
      >
        {/*
          On a phone with the panel open this holds only the controls, so it
          must not still claim a share of the height — two `flex-1` siblings
          would split the column in half and leave the transport stranded in the
          middle of its own empty space. It grows again from lg, where it is
          carrying the cover as well.
        */}
        <div
          className={cn(
            "flex min-h-0 flex-col lg:order-1 lg:flex-1 lg:justify-center",
            panelOpen ? "flex-none" : "flex-1",
          )}
        >
          {/*
            The cover eases down a couple of percent when paused, the way Apple
            Music does. It is the clearest possible signal of playback state and
            it costs one composited transform.

            `snappy` rather than `sheet`: this is a toggle, not travel. The sheet
            spring carries mass 0.9 so that a full-screen slide does not feel
            weightless, and spending that on a 6% nudge makes the artwork visibly
            trail the button that triggered it — on the control pressed more than
            any other in the app.

            Sized against the viewport's *height* as well as its width: capped
            only by width, a short laptop window pushes the transport off the
            bottom, and a tall one leaves the cover stranded and small.
          */}
          <div
            className={cn(
              "place-items-center",
              panelOpen ? "hidden lg:grid lg:pb-8" : "grid flex-1 py-2",
            )}
          >
            <motion.div
              animate={{ scale: isPlaying ? 1 : 0.94 }}
              transition={SPRING.snappy}
              className={
                panelOpen
                  ? "w-[min(30vw,min(38vh,360px))]"
                  : "w-[min(78vw,min(52vh,460px))]"
              }
            >
              {/*
                The cover animates from within while the episode plays — see
                lib/artwork. It renders this exact <Image> underneath and layers
                a shader over it, so if anything at all goes wrong (no WebGL2, a
                host that blocks the pixel read, a device that cannot hold
                60fps) what is left is precisely the static artwork that used to
                be here.
              */}
              <AnimatedArtwork
                src={artworkUrl}
                alt=""
                playing={isPlaying}
                sizes="(max-width: 640px) 78vw, 460px"
                priority
                className="aspect-square w-full rounded-[22px] shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
              />
            </motion.div>
          </div>

          {/*
            Capped and centred under the cover rather than run to the full width
            of the column. The transport belongs to the artwork above it, and a
            play button sitting hundreds of pixels to the left of the thing it
            plays stops reading as a pair.
          */}
          <div className="mx-auto w-full max-w-[520px] shrink-0 pt-4 xl:max-w-[560px]">
            <h1 className="text-balance text-center text-[19px] font-semibold leading-snug -tracking-[0.02em] sm:text-[23px]">
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
                  className="mt-2 text-center text-xs text-red-300"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            {/*
              Sits between the title and the seek bar, which is where it reads
              as a caption on the episode rather than a control. It renders
              nothing when the episode has no chapters, so the layout is
              unchanged for shows that don't publish them.
            */}
            <ChapterStrip episodeId={episode.id} />

            {/* --- scrubber --- */}
            <PositionBar episodeId={episode.id} />

            {/* --- transport --- */}
            <div className="mt-6 flex items-center justify-center gap-7 sm:gap-8">
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
                className="grid size-16 place-items-center rounded-full bg-[#f7f5f0] text-[#1a1c18] shadow-[0_10px_30px_rgba(0,0,0,0.35)] sm:size-[72px]"
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

        {/*
          The one panel instance.

          `order-first` puts it above the controls on a phone, where it stands
          in for the cover; from lg the order resets and it takes the right-hand
          column. It grows with the window rather than sitting at a fixed 440px,
          because the transcript's type is large enough that extra width buys
          whole words per line — but it is capped at 40% so it never starts
          crowding the cover it is meant to accompany.
        */}
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.aside
              key={captionsOpen ? "transcript" : "ask"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={TWEEN.fast}
              className={cn(
                "order-first flex min-h-0 flex-1 flex-col",
                "lg:order-2 lg:w-[min(40vw,560px)] lg:flex-none lg:py-4",
              )}
            >
              {captionsOpen ? (
                <CaptionsPanel episodeId={episode.id} />
              ) : (
                <AskPanel episodeId={episode.id} episodeTitle={episode.title} />
              )}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

type View = "artwork" | "transcript" | "ask";

const VIEWS: { value: View; label: string }[] = [
  { value: "artwork", label: "Artwork" },
  { value: "transcript", label: "Transcript" },
  { value: "ask", label: "Ask" },
];

/**
 * What the space beside the controls is showing.
 *
 * Set as plain words with a rule under the current one, rather than as filled
 * chips. Three bordered pills in the corner of a photographic backdrop read as
 * browser chrome pasted over the artwork — they are the highest-contrast shapes
 * on the screen and the eye goes to them before it goes to the cover. Type
 * alone carries the same three states: the active one is simply the one that is
 * fully lit, which is how the rest of this screen already distinguishes what
 * matters from what is available.
 *
 * Modelled as one exclusive choice rather than two independent toggles because
 * that is what it is — the panel has room for exactly one of them, and
 * "Artwork" is a state in the same set, not a close button.
 */
function ViewSwitch({
  view,
  onChange,
}: {
  view: View;
  onChange: (view: View) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Companion panel"
      className="flex shrink-0 items-center gap-1 sm:gap-2"
    >
      {VIEWS.map(({ value, label }) => {
        const active = view === value;
        return (
          <motion.button
            key={value}
            {...press}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(value)}
            className={cn(
              "relative px-1.5 py-2 text-[12.5px] font-medium tracking-[0.01em] transition-colors sm:px-2",
              active ? "text-white" : "text-white/45 hover:text-white/80",
            )}
          >
            {label}
            {/*
              One rule shared by all three via layoutId, so it slides between
              them. Hairline and inset from the text rather than a full
              underline — it should register as emphasis, not as a border.
            */}
            {active && (
              <motion.span
                layoutId="now-playing-view"
                aria-hidden
                transition={SPRING.pop}
                className="absolute inset-x-1.5 bottom-0.5 h-px rounded-full bg-white/70 sm:inset-x-2"
              />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
