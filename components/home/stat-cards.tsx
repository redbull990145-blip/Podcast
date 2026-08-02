"use client";

import { motion } from "motion/react";
import { SectionLabel } from "@/components/ui/page";
import {
  bentoTile,
  bentoTileDelay,
  bentoTileShadow,
} from "@/lib/motion/variants";
import { formatBytes, formatHours } from "@/lib/stats/summarise";
import type { DashboardStats } from "@/lib/stats/listening";

/**
 * One tile of the bento.
 *
 * `justify-between` with the label and the body as the only two children is
 * what makes a 2×2 of these read as a grid rather than as four unrelated
 * boxes: every label pins to the top of its tile and every figure to the
 * bottom, so both line up across the pair regardless of how much the bodies
 * differ in height. That is also why the body is wrapped in a single element
 * by each caller rather than passed as loose siblings.
 */
function Card({
  label,
  delay,
  children,
}: {
  label: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      variants={bentoTile}
      custom={delay}
      initial="hidden"
      animate="visible"
      /*
       * Labels rather than inline objects, so the shadow layer below follows
       * the same two states without the tile having to know it exists. That is
       * also why this element states its own enter — see `bentoTile`.
       */
      whileHover="hover"
      whileTap="press"
      className="relative"
    >
      {/*
        The hovered tile's deeper shadow, as its own layer.

        It is a *sibling painted before* the card rather than a `-z-10` child of
        it, which is the difference between this working and this being
        invisible. The tile animates `y`, and any element with a transform
        creates a stacking context — inside one, a negative z-index child paints
        above the parent's own background rather than behind it, so the usual
        trick stops meaning what it means everywhere else. Ordering the two in
        the DOM instead needs no z-index at all: this paints, then the opaque
        card paints over it, and only the shadow spilling past the edge shows.
      */}
      <motion.span
        aria-hidden
        variants={bentoTileShadow}
        className="pointer-events-none absolute inset-0 rounded-app-xl shadow-lifted"
      />
      <div className="elev-card relative flex h-full flex-col justify-between gap-3 rounded-app-xl p-5">
        <SectionLabel>{label}</SectionLabel>
        <div>{children}</div>
      </div>
    </motion.div>
  );
}

/**
 * Sized down from 34px.
 *
 * The tiles are roughly half as wide in the bento as they were in the old
 * four-across row, and "Documentary" at 34px did not fit one line in a column
 * that narrow. Shrinking the numeral rather than truncating the word keeps the
 * four tiles reading as one set — a figure that wraps and a figure that does
 * not are visibly two different components.
 */
function Figure({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="text-[30px] font-semibold leading-none -tracking-[0.03em] tabular-nums">
      {value}
      {unit && (
        <span className="ml-1 text-[14px] font-medium text-muted-2">{unit}</span>
      )}
    </p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-2">{children}</p>
  );
}

/**
 * The week at a glance, as a 2×2 bento.
 *
 * Every number is measured, and where one cannot be measured honestly it is not
 * shown — a card whose data has not accumulated yet says so rather than
 * displaying a zero that looks like a failure.
 *
 * The shape is fixed at two columns at every width rather than reflowing from
 * one to two to four. These four figures are a set that is read together — the
 * hours against the completions, the genre against both — and a 1×4 column
 * makes that a scroll instead of a glance. Two columns is the narrowest
 * arrangement where all four are still on screen at once, so it is the one that
 * survives from phone to desktop.
 *
 * The row floor is 150px rather than a fixed height: a locked height either
 * clips the genre breakdown when a name wraps to two lines or leaves the other
 * three tiles hollow. `auto` above the floor lets the taller row set the pace
 * and keeps the pair in each row equal, which is the part that has to be true.
 */
export function StatCards({
  stats,
  delay = 0,
}: {
  stats: DashboardStats;
  /** Position in Home's entrance cascade, in seconds. See `cascade`. */
  delay?: number;
}) {
  const {
    weekSeconds,
    daily,
    completedThisWeek,
    completedLastWeek,
    categories,
    downloadCount,
    downloadBytes,
  } = stats;

  const completionDelta = completedThisWeek - completedLastWeek;
  const peak = Math.max(...daily.map((d) => d.seconds), 1);

  return (
    /*
     * A plain grid. Each tile is handed its own start time off Home's cascade
     * slot, so the bento arrives as a unit that unpacks on the beat the rest of
     * the page is keeping, without this element having to orchestrate anything.
     * See `bentoTile` for why the tiles are not staggered from here.
     */
    <div className="grid grid-cols-2 gap-3.5 [grid-auto-rows:minmax(150px,auto)]">
      <Card label="This week" delay={bentoTileDelay(delay, 0)}>
        <Figure value={formatHours(weekSeconds)} unit="hrs" />

        {/*
          Seven bars, one per day, scaled against the busiest rather than
          against a fixed ceiling — the shape of the week is the point, not the
          absolute height. Days with nothing on them still draw a stub in the
          track colour so the row reads as a full week with gaps rather than as
          a chart that lost its axis.
        */}
        <div className="mt-3 flex h-[30px] items-end gap-[5px]">
          {daily.map((day) => {
            const filled = day.seconds > 0;
            return (
              <span
                key={day.date}
                title={`${day.label} · ${formatHours(day.seconds)} hrs`}
                className={`flex-1 rounded-[3px] ${
                  filled ? "bg-accent-subtle-2" : "bg-track"
                }`}
                style={{
                  height: filled ? `${Math.max(12, (day.seconds / peak) * 100)}%` : "18%",
                }}
              />
            );
          })}
        </div>
      </Card>

      <Card label="Completed" delay={bentoTileDelay(delay, 1)}>
        <Figure value={String(completedThisWeek)} />
        <Note>
          {completedLastWeek === 0 && completedThisWeek === 0
            ? "Nothing finished yet this week."
            : completionDelta === 0
              ? "The same as the week before."
              : completionDelta > 0
                ? `${completionDelta} more than the week before.`
                : `${Math.abs(completionDelta)} fewer than the week before.`}
        </Note>
      </Card>

      <Card label="Most time in" delay={bentoTileDelay(delay, 2)}>
        {categories.length === 0 ? (
          <>
            <p className="text-[20px] font-semibold leading-tight -tracking-[0.02em] text-subtle">
              —
            </p>
            <Note>A week of listening is enough to work this out.</Note>
          </>
        ) : (
          <>
            <p className="line-clamp-2 text-[20px] font-semibold leading-tight -tracking-[0.02em]">
              {categories[0].name}
            </p>
            {/*
              Two lines rather than one, and the reason is the bento. In the old
              four-across row every genre name fitted on one line, so clamping
              to one was free; at half that width "Society & Culture" does not,
              and a single clamped line renders it as "Society &…" — which reads
              as a different genre rather than as a truncation.
            */}
            <div className="mt-3 flex flex-col gap-1.5">
              {categories.map((category, i) => (
                <div key={category.name} className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
                    <span
                      className={`block h-full rounded-full ${
                        i === 0 ? "bg-accent" : i === 1 ? "bg-clay" : "bg-faint-2"
                      }`}
                      style={{ width: `${Math.round(category.share * 100)}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-2">
                    {Math.round(category.share * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card label="Saved offline" delay={bentoTileDelay(delay, 3)}>
        <Figure value={String(downloadCount)} />
        <Note>
          {downloadCount === 0
            ? "Nothing downloaded on this device yet."
            : `${formatBytes(downloadBytes)} across ${
                downloadCount === 1 ? "one episode" : `${downloadCount} episodes`
              }.`}
        </Note>
      </Card>
    </div>
  );
}
