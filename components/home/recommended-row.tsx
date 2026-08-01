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

type Response = {
  recommendations: Recommendation[];
  categories: string[];
  coldStart: boolean;
};

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
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2.5">
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
      className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
    >
      {shows.map((show) => (
        <motion.li key={show.feedUrl} variants={listItem} {...liftCard}>
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
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 180px"
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
                <span className="mt-0.5 block truncate text-[11.5px] text-subtle-2">
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
