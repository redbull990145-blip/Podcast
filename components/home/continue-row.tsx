"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Rss } from "lucide-react";
import { usePlayer } from "@/lib/player/store";
import {
  playableFromContinueItem,
  progressFraction,
  remainingSeconds,
} from "@/lib/player/resume";
import { SPRING } from "@/lib/motion/config";
import { liftCard } from "@/lib/motion/gestures";
import { cascadedList, listItem } from "@/lib/motion/variants";
import type { ContinueItem } from "@/lib/stats/listening";
import { formatDurationLong } from "@/lib/utils";

/**
 * The things most recently left unfinished, after the first.
 *
 * Each card resumes at the saved position on click rather than opening the
 * episode page — someone who left an episode half-finished wants to be back in
 * it, not to read about it. The episode page is one level in, from the title on
 * the show page.
 *
 * The most recent of these is rendered above as `ResumeHero`, so this row
 * receives the tail.
 *
 * A scroller rather than a grid, which is a change of kind and not just of
 * axis. A grid has to decide how many of these are worth showing, and it
 * decides that by cutting the list to whatever fits the row — so the fourth
 * unfinished episode simply did not exist on a narrow window. Scrolling makes
 * the list its own length and lets the layout stop guessing.
 *
 * Fixed-width cards rather than fractional ones, for the same reason: a card
 * sized `1fr` inside a scroller either fills the container (and there is
 * nothing to scroll) or has no defined width at all. 300px is the width at
 * which a two-line episode title stops hyphenating.
 */
export function ContinueRow({
  items,
  delay = 0,
}: {
  items: ContinueItem[];
  /** Position in Home's entrance cascade, in seconds. See `cascade`. */
  delay?: number;
}) {
  return (
    <motion.ul
      /*
       * The cascade slot lands on `delayChildren`: this row has nothing of its
       * own to animate, it only sequences its cards, so being "late" means its
       * first card is late. It has to arrive through `custom` into the variant
       * rather than through a `transition` prop — see `cascadedList`.
       */
      variants={cascadedList}
      custom={delay}
      initial="hidden"
      animate="visible"
      tabIndex={0}
      aria-label="Also unfinished"
      /*
       * The negative margin and matching padding let the row bleed to the edge
       * of the page while its first card stays on the text margin. Without it
       * the last card stops short of the edge and the row looks like it has
       * ended when it has not — the cut-off card is the entire affordance here,
       * since the scrollbar is hidden.
       *
       * The bleed collapses to 8px at `lg`, where the row is no longer full
       * width. A 40px overhang there is not reaching for the edge of the page,
       * it is reaching into the 48px gutter the stats column lives in, and a
       * card scrolling to within 8px of the bento reads as a collision. What is
       * left is only enough to keep a hovered card's shadow off the clip edge.
       *
       * `py` is not symmetric with the bleed for the same reason: it is there to
       * give `liftCard`'s hover translate somewhere to go. A card lifting inside
       * a container with `overflow-x: auto` and no vertical room clips against
       * the top edge.
       */
      className="card-scroller -mx-5 mt-4 gap-3.5 px-5 py-2 sm:-mx-10 sm:px-10 lg:-mx-2 lg:px-2"
    >
      {items.map((item) => (
        <ContinueCard key={item.episodeId} item={item} />
      ))}
    </motion.ul>
  );
}

function ContinueCard({ item }: { item: ContinueItem }) {
  const load = usePlayer((s) => s.load);

  const fraction = progressFraction(item);
  const remaining = remainingSeconds(item);

  function resume() {
    load(playableFromContinueItem(item), item.positionSeconds);
  }

  return (
    <motion.li variants={listItem} {...liftCard} className="w-[300px] shrink-0">
      <button
        onClick={resume}
        aria-label={`Resume ${item.title}`}
        className="elev-card flex h-full w-full flex-col gap-4 rounded-app-lg p-5 text-left transition-colors hover:border-border-strong"
      >
        <span className="flex flex-1 items-start gap-3.5">
          {item.artworkUrl ? (
            <Image
              src={item.artworkUrl}
              alt=""
              width={128}
              height={128}
              sizes="64px"
              className="size-16 shrink-0 rounded-app object-cover shadow-[0_4px_12px_rgb(34_32_29_/_0.14)]"
            />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-app bg-accent-subtle text-accent">
              <Rss className="size-6" />
            </span>
          )}

          <span className="min-w-0">
            <span className="line-clamp-2 text-[14px] font-semibold leading-snug">
              {item.title}
            </span>
            {/*
              `muted-2`, not `subtle-2`. This is the show an episode belongs to
              — the thing that tells you which of two half-finished episodes is
              which — and it was rendering at 2.36:1, which fails WCAG AA at any
              size. See the ramp note in globals.css for why the token itself
              could not simply be darkened far enough.
            */}
            <span className="mt-1 block truncate text-[12px] text-muted-2">
              {item.podcastTitle}
            </span>
          </span>
        </span>

        <span className="flex items-center gap-2.5">
          {/*
            scaleX rather than width. `progressFraction` returns 0–1 already, so
            there is no percentage to divide here — the conversion that plans
            011 and 013 got wrong by dropping a `/100` has been moved into one
            tested function instead of being repeated at each call site.
          */}
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-track">
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: fraction }}
              transition={SPRING.progress}
              className="block h-full origin-left rounded-full bg-accent"
            />
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-muted-2">
            {remaining > 0 ? `${formatDurationLong(remaining)} left` : "Nearly done"}
          </span>
        </span>
      </button>
    </motion.li>
  );
}
