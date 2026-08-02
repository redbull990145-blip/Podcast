import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Flame } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/stats/listening";
import { PageShell } from "@/components/ui/page";
import { Greeting } from "@/components/home/greeting";
import { StatCards } from "@/components/home/stat-cards";
import { ResumeHero } from "@/components/home/resume-hero";
import { ContinueRow } from "@/components/home/continue-row";
import { RecommendedRow } from "@/components/home/recommended-row";
import { CascadeBlock } from "@/components/home/cascade-block";
import { cascade } from "@/lib/motion/variants";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

/**
 * `href`/`action` are optional because not every section has somewhere further
 * to go — the week's figures are complete on this page and there is no stats
 * screen to link to. A "See all" pointing back at the same numbers is worse
 * than no link.
 */
function SectionHeading({
  title,
  href,
  action,
  className,
}: {
  title: React.ReactNode;
  href?: string;
  action?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("mt-11 flex items-baseline justify-between gap-4", className)}
    >
      <h2 className="text-heading font-semibold">{title}</h2>
      {href && action && (
        <Link href={href} className="shrink-0 text-meta font-medium">
          {action}
        </Link>
      )}
    </div>
  );
}

export default async function HomePage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const stats = await getDashboardStats(user.id);

  const firstName =
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    user.email?.split("@")[0] ??
    "you";

  /*
   * The most-unfinished episode is promoted out of the list into the hero, and
   * the rest of the list follows it.
   *
   * The ordering of this page changed here, and the reason is worth recording:
   * it used to run greeting → statistics → continue → suggestions, which put a
   * report on last week's listening above the episode the person had stopped
   * half-way through. Statistics are retrospective. They are a pleasant thing
   * to find and they have never once caused anyone to press play, so they now
   * sit below both of the things that can.
   */
  const { continueListening, streakDays } = stats;
  const [nextUp, ...alsoUnfinished] = continueListening;

  return (
    /*
     * Home is the one screen allowed past the app's 1000px measure.
     *
     * That measure exists to stop a grid of square covers from growing past the
     * size where the artwork is legible — see `PageShell`. Nothing in the two
     * columns below is a cover grid: the left column is one hero and a row of
     * fixed-width cards, and the right is four tiles of text. Both have a
     * natural size and simply stop when they reach it, so the extra width buys
     * a second column instead of stretching a first one. Every other screen
     * keeps the narrower measure.
     */
    <PageShell className="max-w-[1360px]">
      {/*
       * Two columns, and the split is done with grid rows rather than by
       * nesting two independent columns.
       *
       * The requirement is that the stats line up with the top of the hero, not
       * with the top of the page — the greeting above it is three lines tall
       * and the stats have no equivalent. The obvious fix is a top margin on
       * the right column of roughly the greeting's height, and it is wrong: it
       * is a hardcoded number that has to be re-guessed whenever the headline
       * wraps, which it does at every width between `lg` and the point where
       * "Welcome back, <name>" fits on one line.
       *
       * Placing both columns in one grid makes the browser do that measurement.
       * The greeting occupies row 1 of column 1 and nothing occupies row 1 of
       * column 2, so row 1 is exactly as tall as the greeting happens to be,
       * whatever that turns out to be, and row 2 starts level in both columns.
       *
       * The bento then spans rows 2 and 3 so that the carousel — row 3 of
       * column 1 — sits directly under the hero rather than being pushed below
       * the taller of the two. `items-start` keeps each item at its natural
       * height inside the row instead of stretching to match its neighbour.
       */}
      {/*
        The `cascade(n)` calls below are the page's entrance sequence, in
        reading order: greeting, hero, carousel, statistics. They are indices
        into one timeline rather than four independent delays, so re-ordering
        the page means re-numbering rather than re-timing it.

        The grid itself is not a motion element. Each block starts itself — see
        the note on `cascade` for why propagating one container's variant does
        not survive this page's server/client boundaries.
      */}
      <div className="flex flex-col lg:grid lg:grid-cols-[1.4fr_minmax(300px,1fr)] lg:items-start lg:gap-x-12">
        {/* `mb-6` rather than a margin on the hero — see the note in `ResumeHero`. */}
        <CascadeBlock
          index={0}
          className="order-1 mb-6 flex min-w-0 items-end justify-between gap-6 lg:col-start-1 lg:row-start-1"
        >
          <div className="min-w-0">
            <Greeting />
            <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.1] -tracking-[0.03em] sm:text-[38px]">
              Welcome back, {firstName}
            </h1>
            {/*
              The subtitle no longer names the unfinished episode, because the
              hero directly below now shows it with its artwork, its progress and
              a button. Saying the title twice in two adjacent blocks made the
              page read as though it were insisting.
            */}
            <p className="mt-2.5 text-pretty text-body text-muted">
              {nextUp
                ? "Ready when you are."
                : "Nothing half-finished — a clean slate to start something on."}
            </p>
          </div>

          {/*
            The streak only appears once there is one. A "0-day streak" badge is a
            reprimand, and rendering it on an empty account is the app's first
            impression.
          */}
          {streakDays > 0 && (
            <div className="hidden shrink-0 items-center gap-2 rounded-full bg-clay-subtle px-3.5 py-2 text-clay-ink sm:flex">
              <Flame className="size-[15px]" strokeWidth={1.75} />
              <span className="text-[13px] font-semibold tabular-nums">
                {streakDays}-day streak
              </span>
            </div>
          )}
        </CascadeBlock>

        <div className="order-2 min-w-0 lg:col-start-1 lg:row-start-2">
          {nextUp && <ResumeHero item={nextUp} delay={cascade(1)} />}
        </div>

        {/*
          `min-w-0` is load-bearing on this one. The carousel inside it is an
          `overflow-x` container, and a grid track sized `1.4fr` still resolves
          its *minimum* to the content's min-content width unless told otherwise
          — so without this the scroller reports the full width of every card it
          holds, the column grows to fit them all, and the row never scrolls.
        */}
        <div className="order-3 min-w-0 lg:col-start-1 lg:row-start-3">
          {alsoUnfinished.length > 0 && (
            <>
              <SectionHeading title="Also unfinished" href="/queue" action="Open queue" />
              <ContinueRow items={alsoUnfinished} delay={cascade(2)} />
            </>
          )}
        </div>

        {/*
          Ordered last on a narrow window, which is the one thing that had to
          survive the move into a column.
          `order-5` puts it back below the suggestions.
        */}
        <section
          aria-labelledby="week-heading"
          className="order-5 min-w-0 lg:col-start-2 lg:row-start-2 lg:row-end-4"
        >
          {/*
            The heading is visually hidden on desktop and shown below it. In the
            two-column layout the four tiles sit beside a hero that is already
            captioned, each carries its own label, and the column reads as a
            panel of statistics without being told — a heading there would be
            the only text on the page pointing at something adjacent to it.
            Stacked on a narrow window it is the section's only introduction,
            so it comes back.
          */}
          <SectionHeading
            title={<span id="week-heading">Your week</span>}
            className="lg:sr-only"
          />
          <div className="mt-4 lg:mt-0">
            <StatCards stats={stats} delay={cascade(3)} />
          </div>
        </section>

        {/*
          Full width, below both columns. Suggestions are a five-across grid of
          square covers — the one thing on this page the 1000px measure was
          written for — so they get the whole width and their own row rather
          than being squeezed into a 1.4fr column.
        */}
        {/*
          Deliberately outside the cascade's schedule. `RecommendedRow` fetches,
          so it cannot arrive on a timetable set when the page painted — by the
          time it has an answer the cascade finished long ago, and a block held
          back for it would be holding back an empty box. It keeps its own
          entrance, which starts when its data does.
        */}
        <div className="order-4 min-w-0 lg:col-start-1 lg:col-end-3 lg:row-start-4">
          <SectionHeading
            title="Suggested for you"
            href="/discover"
            action="More like this"
          />
          <RecommendedRow />
        </div>
      </div>
    </PageShell>
  );
}
