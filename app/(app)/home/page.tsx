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
}: {
  title: React.ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="mt-11 flex items-baseline justify-between gap-4">
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
    <PageShell>
      <div className="flex items-end justify-between gap-6">
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
      </div>

      {nextUp && <ResumeHero item={nextUp} />}

      {alsoUnfinished.length > 0 && (
        <>
          <SectionHeading title="Also unfinished" href="/queue" action="Open queue" />
          <ContinueRow items={alsoUnfinished} />
        </>
      )}

      <SectionHeading title="Suggested for you" href="/discover" action="More like this" />
      <RecommendedRow />

      <SectionHeading title="Your week" />
      <StatCards stats={stats} />
    </PageShell>
  );
}
