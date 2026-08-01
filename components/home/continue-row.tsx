"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Rss } from "lucide-react";
import { usePlayer, type PlayableEpisode } from "@/lib/player/store";
import { liftCard } from "@/lib/motion/gestures";
import { listContainer, listItem } from "@/lib/motion/variants";
import type { ContinueItem } from "@/lib/stats/listening";
import { formatDurationLong } from "@/lib/utils";

/**
 * The three things most recently left unfinished.
 *
 * Each card resumes at the saved position on click rather than opening the
 * episode page — someone who left an episode half-finished wants to be back in
 * it, not to read about it. The episode page is one level in, from the title on
 * the show page.
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

  const duration = item.durationSeconds ?? 0;
  const percent =
    duration > 0 ? Math.min(100, Math.round((item.positionSeconds / duration) * 100)) : 0;
  const remaining = duration > 0 ? duration - item.positionSeconds : 0;

  function resume() {
    const playable: PlayableEpisode = {
      id: item.episodeId,
      title: item.title,
      enclosureUrl: item.enclosureUrl,
      durationSeconds: item.durationSeconds,
      artworkUrl: item.artworkUrl,
      podcastId: item.podcastId,
      podcastTitle: item.podcastTitle,
      categories: item.categories,
    };
    load(playable, item.positionSeconds);
  }

  return (
    <motion.li variants={listItem} {...liftCard}>
      <button
        onClick={resume}
        aria-label={`Resume ${item.title}`}
        className="flex w-full flex-col gap-3 rounded-app-lg border border-border-2 bg-surface p-4 text-left transition-colors hover:border-border-strong"
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
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-track">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${percent}%` }}
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
