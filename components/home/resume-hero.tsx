"use client";

import { motion } from "motion/react";
import { Play } from "lucide-react";
import { AnimatedArtwork } from "@/components/artwork/animated-artwork";
import { MotionLink } from "@/components/ui/motion-link";
import { useArtworkTint } from "@/lib/artwork/tint";
import { usePlayer } from "@/lib/player/store";
import {
  playableFromContinueItem,
  progressFraction,
  remainingSeconds,
} from "@/lib/player/resume";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { dashboardBlock } from "@/lib/motion/variants";
import { pressPrimary, pressSubtle } from "@/lib/motion/gestures";
import type { ContinueItem } from "@/lib/stats/listening";
import { formatDurationLong } from "@/lib/utils";

/**
 * The single most-unfinished episode, given the top of the screen.
 *
 * This is the one structural change on Home, and the argument for it is about
 * ranking rather than styling. An episode someone is part-way through is the
 * highest-intent object the app can show them: they have already chosen it,
 * already started it, and stopping part-way leaves the kind of open loop people
 * are reliably drawn back to finish. Everything else on this page is either a
 * report on what already happened or a request that they evaluate something
 * new, and both are more work than continuing.
 *
 * So the hero is deliberately not a summary. It is one object and one button.
 * The remaining time is stated in minutes rather than as a percentage because
 * "18m left" is a decision someone can make against the time they actually
 * have, and "68%" is not.
 *
 * Only ever rendered when there *is* something unfinished — Home falls back to
 * its ordinary layout otherwise. A hero explaining that you have not started
 * anything is a worse first impression than no hero.
 */
export function ResumeHero({
  item,
  delay = 0,
}: {
  item: ContinueItem;
  /** Position in Home's entrance cascade, in seconds. See `cascade`. */
  delay?: number;
}) {
  const load = usePlayer((s) => s.load);

  /*
   * Episode identity and play/pause only — never `currentTime`. This component
   * sits above the whole page and the position republishes about four times a
   * second, so reading it here would re-render the hero, its artwork wrapper
   * and the engine's host on every tick. `player-bar.tsx` solves the same
   * problem the same way, by keeping position in leaf components.
   */
  const currentId = usePlayer((s) => s.episode?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);

  const tint = useArtworkTint(item.artworkUrl);

  const isCurrent = currentId === item.episodeId;
  const playing = isCurrent && isPlaying;

  const fraction = progressFraction(item);
  const remaining = remainingSeconds(item);

  /*
   * The goal gradient: the closer the end is, the more the bar is worth
   * looking at. Implemented as opacity on a glow layer rather than as a size or
   * colour change, so it stays a compositor-only property and so the bar itself
   * never moves — the thing being emphasised is the progress, not the chrome.
   *
   * It stays at zero for the first two-thirds. An episode 20% finished is not
   * nearly done, and lighting it up as though it were is the sort of flattery
   * that stops meaning anything the second time someone sees it.
   */
  const nearEnd = Math.max(0, (fraction - 0.66) / 0.34);

  function resume() {
    load(playableFromContinueItem(item), item.positionSeconds);
  }

  return (
    <motion.section
      /*
       * Its own animation root, told when to start rather than orchestrated
       * from above — see the note on `cascade` for why.
       *
       * `dashboardBlock` rather than `fadeUp` because the two differ only in
       * travel (15px against 8), and this is one of the large blocks that
       * distinction exists for. See the note on `dashboardBlock`.
       */
      variants={dashboardBlock}
      custom={delay}
      initial="hidden"
      animate="visible"
      style={tint}
      aria-labelledby="resume-hero-title"
      /*
       * No top margin. It used to carry `mt-6` for the gap under the greeting,
       * which stopped working when Home became two columns: a margin on this
       * element sits *inside* its grid area, so it pushed the hero down 24px
       * while the stats beside it stayed at the top of the same row. The gap is
       * now a bottom margin on the greeting, which extends row 1 and therefore
       * moves both columns together.
       */
      className="elev-raised tint-ring relative overflow-hidden rounded-app-xl"
    >
      {/* The cover's own colour, bled into the panel behind it. */}
      <div aria-hidden className="tint-wash pointer-events-none absolute inset-0" />

      <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
        <AnimatedArtwork
          src={item.artworkUrl}
          alt=""
          playing={playing}
          priority
          sizes="(min-width: 640px) 168px, 128px"
          className="size-32 shrink-0 rounded-app-lg shadow-art sm:size-42"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            Deliberately not <SectionLabel>, which hardcodes `text-subtle-2`.
            Tailwind emits that in the utilities layer and `.tint-ink` lives in
            the components layer, so the utility would win on cascade order and
            the label would silently render grey — passing `tint-ink` as a
            className looks like it works and does not.
          */}
          <p className="text-micro font-semibold uppercase tint-ink">
            {playing ? "Playing now" : "Pick up where you left off"}
          </p>

          <h2 id="resume-hero-title" className="mt-2 min-w-0">
            <MotionLink
              {...pressSubtle}
              href={`/episode/${item.episodeId}`}
              className="line-clamp-2 inline-block text-heading font-semibold text-balance"
            >
              {item.title}
            </MotionLink>
          </h2>

          <MotionLink
            {...pressSubtle}
            href={`/podcast/${item.podcastId}`}
            className="mt-1.5 self-start truncate text-meta text-muted transition-colors hover:text-foreground"
          >
            {item.podcastTitle}
          </MotionLink>

          <div className="mt-5 flex items-center gap-4">
            <motion.button
              {...pressPrimary}
              onClick={resume}
              aria-label={`Resume ${item.title}`}
              className="grid size-13 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground shadow-accent transition-colors hover:bg-accent-hover"
            >
              {/*
                Nudged right by a pixel. A triangle's optical centre sits behind
                its geometric one, so a centred play glyph reads as leaning left
                — which is the one direction a play button must never suggest.
              */}
              <Play className="size-5 translate-x-px" fill="currentColor" strokeWidth={0} />
            </motion.button>

            <div className="min-w-0 flex-1">
              <div className="relative h-1.5 overflow-hidden rounded-full bg-track">
                <motion.div
                  aria-hidden
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: fraction }}
                  transition={SPRING.progress}
                  className="h-full origin-left rounded-full bg-accent"
                />
                <motion.div
                  aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: nearEnd * 0.5 }}
                  transition={TWEEN.slow}
                  className="pointer-events-none absolute inset-0 rounded-full bg-accent blur-[3px]"
                />
              </div>

              <p className="mt-2 text-micro tracking-normal tabular-nums text-muted-2">
                {remaining > 0
                  ? `${formatDurationLong(remaining)} left`
                  : "Almost done"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
