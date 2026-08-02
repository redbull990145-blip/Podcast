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
import { listContainer, listItem } from "@/lib/motion/variants";
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
 * The most recent of these is rendered above as `ResumeHero`, so this list
 * receives the tail. That split is why the grid is sized for two or three
 * rather than exactly three.
 */
export function ContinueRow({ items }: { items: ContinueItem[] }) {
  return (
    <motion.ul
      variants={listContainer}
      initial="hidden"
      animate="visible"
      className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
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
    <motion.li variants={listItem} {...liftCard}>
      <button
        onClick={resume}
        aria-label={`Resume ${item.title}`}
        className="elev-card flex w-full flex-col gap-3 rounded-app-lg p-4 text-left transition-colors hover:border-border-strong"
      >
        <span className="flex items-start gap-3">
          {item.artworkUrl ? (
            <Image
              src={item.artworkUrl}
              alt=""
              width={104}
              height={104}
              sizes="52px"
              className="size-13 shrink-0 rounded-app object-cover shadow-[0_4px_12px_rgb(34_32_29_/_0.14)]"
            />
          ) : (
            <span className="grid size-13 shrink-0 place-items-center rounded-app bg-accent-subtle text-accent">
              <Rss className="size-5" />
            </span>
          )}

          <span className="min-w-0">
            <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug">
              {item.title}
            </span>
            <span className="mt-1 block truncate text-[11.5px] text-subtle-2">
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
          <span className="shrink-0 text-[11px] tabular-nums text-subtle">
            {remaining > 0 ? `${formatDurationLong(remaining)} left` : "Nearly done"}
          </span>
        </span>
      </button>
    </motion.li>
  );
}
