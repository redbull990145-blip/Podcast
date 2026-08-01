import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Flame } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/stats/listening";
import { PageShell } from "@/components/ui/page";
import { Greeting } from "@/components/home/greeting";
import { StatCards } from "@/components/home/stat-cards";
import { ContinueRow } from "@/components/home/continue-row";
import { RecommendedRow } from "@/components/home/recommended-row";

export const metadata: Metadata = { title: "Home" };

function SectionHeading({
  title,
  href,
  action,
}: {
  title: React.ReactNode;
  href: string;
  action: string;
}) {
  return (
    <div className="mt-11 flex items-baseline justify-between gap-4">
      <h2 className="text-[19px] font-semibold -tracking-[0.02em]">{title}</h2>
      <Link href={href} className="shrink-0 text-[13px] font-medium">
        {action}
      </Link>
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

  const { continueListening, streakDays } = stats;
  const nextUp = continueListening[0];

  return (
    <PageShell>
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <Greeting />
          <h1 className="mt-2.5 text-[30px] font-semibold leading-[1.1] -tracking-[0.03em] sm:text-[38px]">
            Welcome back, {firstName}
          </h1>
          <p className="mt-2.5 text-pretty text-[15px] text-muted">
            {nextUp
              ? `You're partway through ${nextUp.title}.`
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

      <StatCards stats={stats} />

      {continueListening.length > 0 && (
        <>
          <SectionHeading title="Continue listening" href="/queue" action="Open queue" />
          <ContinueRow items={continueListening} />
        </>
      )}

      <SectionHeading title="Suggested for you" href="/discover" action="More like this" />
      <RecommendedRow />
    </PageShell>
  );
}
