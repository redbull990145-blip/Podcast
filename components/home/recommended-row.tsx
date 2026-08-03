"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Rss } from "lucide-react";
import type { Recommendation } from "@/lib/recommender/score-candidates";
import { Skeleton } from "@/components/ui/page";
import { liftCard } from "@/lib/motion/gestures";
import { listContainer, listItem } from "@/lib/motion/variants";
import { cn } from "@/lib/utils";

type Response = {
  recommendations: Recommendation[];
  categories: string[];
  coldStart: boolean;
};

/**
 * A scrolling row on a phone, a grid from `sm`.
 *
 * Five covers two-across is two and a half rows of scroll for a section that is
 * explicitly a glance on the way somewhere else — it takes more vertical space
 * than the unfinished episodes above it, which are the things someone actually
 * came back for. Sideways it is one 132px band, the last cover is cut off at
 * the edge to say there is more, and the section costs what it is worth.
 *
 * Shared with the loading state below so the placeholders occupy the same
 * boxes the covers will. A skeleton that reflows into a different shape is
 * worse than no skeleton.
 */
const LAYOUT = [
  "card-scroller -mx-5 gap-3 px-5 pb-1",
  /*
   * `scroll-pl-5` matches the padding, and without it the padding does not
   * survive the first paint. `.card-scroller` snaps on `x`, its children align
   * `start`, and with the default `scroll-padding: auto` the snapport begins at
   * the *padding box* — so the browser snaps the first cover's left edge to
   * there and lands on `scrollLeft: 20`, scrolling the 20px straight back off.
   * The row opens with its first cover flush against the edge of the screen and
   * no gesture has happened. Setting the scroll padding moves the snapport in
   * to where the content actually starts.
   */
  "scroll-pl-5",
  // `overflow-visible` because `.card-scroller`'s `overflow-x: auto` makes the
  // block a scroll container on both axes, which clips `liftCard`'s hover
  // translate against the top edge once this is a grid.
  "sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 sm:scroll-pl-0",
  "lg:grid-cols-5",
].join(" ");

/** Fixed width in the row; the grid track's width from `sm`. */
const CARD = "w-[132px] shrink-0 sm:w-auto sm:shrink";

/**
 * A row of suggested shows, artwork first.
 *
 * Deliberately thinner than the cards on Discover: this is a glance on the way
 * to something else, so it carries a cover, a title and an author and leaves
 * the reasons, the follow button and the dismiss control to the page that is
 * actually about finding shows. Both read the same query key, so arriving at
 * Discover from here costs no second request.
 */
export function RecommendedRow() {
  const { data, isPending, isError } = useQuery<Response>({
    queryKey: ["recommendations"],
    queryFn: async () => {
      const res = await fetch("/api/recommendations");
      if (!res.ok) throw new Error("Couldn't load recommendations.");
      return res.json();
    },
    staleTime: 10 * 60_000,
  });

  if (isError) return null;

  if (isPending) {
    return (
      <div className={cn(LAYOUT, "mt-4")}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={cn(CARD, "space-y-2.5")}>
            <Skeleton className="aspect-square w-full rounded-app-lg" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  const shows = data.recommendations.slice(0, 5);
  if (data.coldStart || shows.length === 0) return null;

  return (
    <motion.ul
      variants={listContainer}
      initial="hidden"
      animate="visible"
      className={cn(LAYOUT, "mt-4")}
    >
      {shows.map((show) => (
        <motion.li key={show.feedUrl} variants={listItem} {...liftCard} className={CARD}>
          <Link
            href="/discover"
            className="flex flex-col gap-2.5"
            title={`${show.title} — find this on Discover`}
          >
            {show.artworkUrl ? (
              <Image
                src={show.artworkUrl}
                alt=""
                width={400}
                height={400}
                sizes="(max-width: 640px) 132px, (max-width: 1024px) 33vw, 180px"
                className="aspect-square w-full rounded-[14px] object-cover shadow-[var(--shadow-art)]"
              />
            ) : (
              <span className="grid aspect-square w-full place-items-center rounded-[14px] bg-accent-subtle text-accent">
                <Rss className="size-7" />
              </span>
            )}
            <span className="min-w-0">
              <span className="line-clamp-2 text-[13px] font-semibold leading-snug">
                {show.title}
              </span>
              {show.author && (
                <span className="mt-0.5 block truncate text-[11.5px] text-muted-2">
                  {show.author}
                </span>
              )}
            </span>
          </Link>
        </motion.li>
      ))}
    </motion.ul>
  );
}
