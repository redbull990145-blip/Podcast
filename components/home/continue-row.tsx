"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Play, Rss } from "lucide-react";
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
 *
 * ## On a phone it turns the corner and becomes a list
 *
 * Everything above is an argument for a horizontal row *given horizontal room
 * to spend*. At 402px a 300px card is three quarters of the screen, so the row
 * shows one and a bit of them: the affordance that was supposed to say "there
 * is more" is now the only thing on screen, and finding the third unfinished
 * episode costs two flicks along an axis nothing else on the page uses.
 *
 * Stacked, the same list is four rows deep and every one of them is legible
 * without a gesture. The cards restack too rather than just narrowing — a
 * 96px-tall row with the cover, the title, the time left and a play button on
 * one line is the shape a phone reads fastest, and it is what the mini player
 * and the queue already look like.
 *
 * It is the same element throughout, moved by flex direction, so nothing here
 * is mounted twice. See the class list on the container.
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
       * `flex-col` is a utility and `.card-scroller` is a component class, so
       * the utility wins below `lg` and the row simply stands up. It keeps the
       * scroller's snap and overscroll behaviour, both of which are inert on an
       * axis with nothing to scroll.
       *
       * `overflow-visible` has to come with it. `.card-scroller` sets
       * `overflow-x: auto`, which makes the block a scroll container on *both*
       * axes — and stacked, with each card's `shadow-soft` reaching 24px past
       * its box, that clips the last card's shadow flat against the bottom
       * edge. There is nothing to scroll on this axis anyway.
       *
       * From `lg` the scroller comes back, and with it the negative margin and
       * matching padding that let the row bleed to the edge of the page while
       * its first card stays on the text margin. Without that the last card
       * stops short of the edge and the row looks like it has ended when it has
       * not — the cut-off card is the entire affordance there, since the
       * scrollbar is hidden. Stacked, there is no cut-off card to rescue, so
       * the list keeps the page's own margins.
       *
       * The bleed is only 8px rather than the page's full 20: at `lg` this row
       * is no longer full width, and a 40px overhang would be reaching into the
       * 48px gutter the stats column lives in rather than toward the edge of
       * the page. `lg:py-2` is not symmetric with it and is doing a different
       * job — giving `liftCard`'s hover translate somewhere to go, since a card
       * lifting inside a scroll container with no vertical room clips against
       * the top edge.
       */
      className="card-scroller mt-3 flex-col gap-2.5 overflow-visible lg:-mx-2 lg:mt-4 lg:flex-row lg:gap-3.5 lg:overflow-x-auto lg:px-2 lg:py-2"
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

  const timeLeft =
    remaining > 0 ? `${formatDurationLong(remaining)} left` : "Nearly done";

  return (
    <motion.li variants={listItem} {...liftCard} className="w-full shrink-0 lg:w-[300px]">
      <button
        onClick={resume}
        aria-label={`Resume ${item.title}`}
        className="elev-card flex h-full w-full flex-col gap-2.5 rounded-app-lg p-3 text-left transition-colors hover:border-border-strong lg:gap-4 lg:p-5"
      >
        <span className="flex flex-1 items-center gap-3 lg:items-start lg:gap-3.5">
          {item.artworkUrl ? (
            <Image
              src={item.artworkUrl}
              alt=""
              width={128}
              height={128}
              sizes="64px"
              className="size-13 shrink-0 rounded-app object-cover shadow-[0_4px_12px_rgb(34_32_29_/_0.14)] lg:size-16"
            />
          ) : (
            <span className="grid size-13 shrink-0 place-items-center rounded-app bg-accent-subtle text-accent lg:size-16">
              <Rss className="size-6" />
            </span>
          )}

          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug lg:text-[14px]">
              {item.title}
            </span>
            {/*
              `muted-2`, not `subtle-2`. This is the show an episode belongs to
              — the thing that tells you which of two half-finished episodes is
              which — and it was rendering at 2.36:1, which fails WCAG AA at any
              size. See the ramp note in globals.css for why the token itself
              could not simply be darkened far enough.
            */}
            <span className="mt-1 block truncate text-[11.5px] text-muted-2 lg:text-[12px]">
              {item.podcastTitle}
              {/* The row form has no second line to put the time on, and it is
                  the one number that says how much of a commitment resuming is. */}
              <span className="lg:hidden"> · {timeLeft}</span>
            </span>
          </span>

          {/*
            The row's play affordance, phone only. A 300px card is unambiguously
            one target and needs no glyph inside it to say so; a full-width row
            in a stack of full-width rows is the shape of a link to a detail
            page, and this one starts playback instead. Inside the button rather
            than beside it, so it is decoration on one target, not a second one.
          */}
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent lg:hidden"
          >
            <Play className="size-[15px]" fill="currentColor" strokeWidth={0} />
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
          <span className="hidden shrink-0 text-[11.5px] tabular-nums text-muted-2 lg:block">
            {timeLeft}
          </span>
        </span>
      </button>
    </motion.li>
  );
}
