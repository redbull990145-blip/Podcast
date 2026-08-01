"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Rss } from "lucide-react";
import { MotionLink } from "@/components/ui/motion-link";
import { SPRING } from "@/lib/motion/config";
import { liftCard, pressSubtle } from "@/lib/motion/gestures";
import { listContainer, listItem } from "@/lib/motion/variants";
import { cn } from "@/lib/utils";

export type LibraryShow = {
  id: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  /** Published recently and never started. Drives the badge and the count. */
  unheard: number;
  /** "3 new · Documentary", for the grid, where there is no separate badge. */
  meta: string;
  /** Just the category, for the list, where the count is already a pill. */
  category: string;
};

type View = "grid" | "list";

/**
 * The library, as covers or as rows.
 *
 * Deliberately unpersisted. The choice is about what someone is doing right now
 * — browsing for something to listen to, or scanning for a specific show — and
 * both are one click apart. Storing it means a preference set once in one mood
 * silently governs every later visit.
 */
export function ShowGrid({ shows }: { shows: LibraryShow[] }) {
  const [view, setView] = useState<View>("grid");

  return (
    <>
      <div className="mt-7 flex justify-end">
        <ViewToggle value={view} onChange={setView} />
      </div>

      {/*
        `mode="wait"` so the outgoing layout is gone before the incoming one
        starts. Without it the old grid simply vanished on the same frame the
        list began staggering in — the two layouts have completely different
        row heights, so crossfading them overlaps mismatched boxes and reads as
        a glitch rather than a change of view. Waiting costs the exit's 140ms
        and buys a clean hand-off.
      */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.ul
          variants={listContainer}
          initial="hidden"
          animate="visible"
          exit="exit"
          // Keyed on the view so switching re-runs the stagger rather than
          // silently swapping one layout's contents into the other's boxes.
          key={view}
          className={cn(
            "mt-5",
            view === "grid"
              ? "grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4"
              : "flex flex-col",
          )}
        >
          {shows.map((show) =>
            view === "grid" ? (
              <GridCard key={show.id} show={show} />
            ) : (
              <ListRow key={show.id} show={show} />
            ),
          )}
        </motion.ul>
      </AnimatePresence>
    </>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: View;
  onChange: (v: View) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Library layout"
      className="flex gap-0.5 rounded-[11px] bg-surface-raised p-[3px]"
    >
      {(["grid", "list"] as const).map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={cn(
              "relative rounded-lg px-3 py-1.5 text-[12.5px] capitalize transition-colors",
              active ? "font-semibold text-foreground" : "text-subtle hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="library-view"
                aria-hidden
                // Was falling through to Motion's default transition, which is
                // a different curve from every other sliding plate in the app.
                transition={SPRING.pop}
                className="absolute inset-0 -z-10 rounded-lg bg-surface shadow-[0_1px_2px_rgb(34_32_29_/_0.06)]"
              />
            )}
            {option}
          </button>
        );
      })}
    </div>
  );
}

function Artwork({
  show,
  className,
  sizes,
  width,
}: {
  show: LibraryShow;
  className: string;
  sizes: string;
  width: number;
}) {
  if (!show.artworkUrl) {
    return (
      <span className={cn("grid place-items-center bg-accent-subtle text-accent", className)}>
        <Rss className="size-7" />
      </span>
    );
  }
  return (
    <Image
      src={show.artworkUrl}
      alt=""
      width={width}
      height={width}
      sizes={sizes}
      className={cn("object-cover", className)}
    />
  );
}

function NewBadge({ count }: { count: number }) {
  return (
    <span className="absolute left-3 top-3 rounded-full bg-[rgb(250_248_244_/_0.92)] px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.04em] text-accent">
      {count === 1 ? "NEW" : `${count} NEW`}
    </span>
  );
}

function GridCard({ show }: { show: LibraryShow }) {
  return (
    <motion.li variants={listItem} {...liftCard}>
      <Link href={`/podcast/${show.id}`} className="flex flex-col gap-2.5">
        <span className="relative block">
          <Artwork
            show={show}
            width={400}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 220px"
            className="aspect-square w-full rounded-app-lg shadow-[var(--shadow-art)]"
          />
          {show.unheard > 0 && <NewBadge count={show.unheard} />}
        </span>

        <span className="min-w-0">
          <span className="line-clamp-2 text-sm font-semibold leading-snug">
            {show.title}
          </span>
          {show.author && (
            <span className="mt-1 block truncate text-xs text-subtle-2">
              {show.author}
            </span>
          )}
          <span className="mt-1.5 block truncate text-[11.5px] text-faint">
            {show.meta}
          </span>
        </span>
      </Link>
    </motion.li>
  );
}

function ListRow({ show }: { show: LibraryShow }) {
  return (
    <motion.li variants={listItem} className="border-b border-border-4 last:border-0">
      <MotionLink
        {...pressSubtle}
        href={`/podcast/${show.id}`}
        className="flex items-center gap-4 rounded-app-md px-2 py-3.5 transition-colors hover:bg-surface"
      >
        <span className="relative block shrink-0">
          <Artwork
            show={show}
            width={112}
            sizes="56px"
            className="size-14 rounded-app shadow-[0_4px_12px_rgb(34_32_29_/_0.14)]"
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{show.title}</span>
          {show.author && (
            <span className="mt-0.5 block truncate text-xs text-subtle-2">
              {show.author}
            </span>
          )}
        </span>

        <span className="hidden shrink-0 text-[11.5px] text-faint sm:block">
          {show.category}
        </span>

        {show.unheard > 0 && (
          <span className="shrink-0 rounded-full bg-accent-subtle px-2.5 py-1 text-[10.5px] font-semibold text-accent">
            {show.unheard} new
          </span>
        )}
      </MotionLink>
    </motion.li>
  );
}
