import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { Library } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { episodes, playbackState, subscriptions } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";
import { ShowGrid, type LibraryShow } from "@/components/library/show-grid";
import { formatRelativeDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Library" };

/**
 * How far back an episode still counts as "new".
 *
 * Without a window, a show followed today reports its entire back catalogue as
 * unheard and every cover in the library wears a badge — which is the same as
 * no badges at all. A month is roughly two issues of a fortnightly show, so a
 * feed is only ever flagged for something genuinely recent.
 */
const NEW_WINDOW_DAYS = 30;

export default async function LibraryPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const since = new Date(Date.now() - NEW_WINDOW_DAYS * 86_400_000);

  const [rows, activity] = await Promise.all([
    db.query.subscriptions.findMany({
      where: eq(subscriptions.userId, user.id),
      with: { podcast: true },
      orderBy: (s, { desc }) => [desc(s.subscribedAt)],
    }),

    /*
     * Unheard-and-recent count, plus the newest publish date, for every show
     * followed — in one grouped pass rather than a query per cover.
     *
     * The left join is the "unheard" test: a row in playback_state means the
     * episode was at least started, so the episodes with no matching row are
     * exactly the ones never touched. `filter (where …)` keeps that count in
     * the same scan that finds the latest publish date.
     */
    db
      .select({
        podcastId: episodes.podcastId,
        /*
         * The comparisons go through drizzle's own helpers rather than being
         * written inline in the template. A bare `${since}` interpolates the
         * Date with no column to infer a type from, so it binds as Postgres's
         * idea of a string — which is `Fri Jul 03 2026 …`, and is rejected.
         * `gte` knows the column and encodes it correctly.
         */
        unheard: sql<number>`count(*) filter (
          where ${isNull(playbackState.episodeId)}
          and ${gte(episodes.publishedAt, since)}
        )::int`,
        latest: sql<Date | null>`max(${episodes.publishedAt})`,
      })
      .from(episodes)
      .innerJoin(
        subscriptions,
        and(
          eq(subscriptions.podcastId, episodes.podcastId),
          eq(subscriptions.userId, user.id),
        ),
      )
      .leftJoin(
        playbackState,
        and(
          eq(playbackState.episodeId, episodes.id),
          eq(playbackState.userId, user.id),
        ),
      )
      .groupBy(episodes.podcastId),
  ]);

  const byPodcast = new Map(activity.map((a) => [a.podcastId, a]));

  const shows: LibraryShow[] = rows.map(({ podcast }) => {
    const stats = byPodcast.get(podcast.id);
    const unheard = stats?.unheard ?? 0;
    const latest = stats?.latest ? new Date(stats.latest) : null;
    const category = podcast.categories[0] ?? "";

    // Whichever is the more useful thing to know: that there is something
    // waiting, or — when there isn't — how long it has been quiet.
    const lead = unheard > 0 ? `${unheard} new` : latest ? formatRelativeDate(latest) : null;

    return {
      id: podcast.id,
      title: podcast.title,
      author: podcast.author,
      artworkUrl: podcast.artworkUrl,
      unheard,
      meta: [lead, category].filter(Boolean).join(" · "),
      category,
    };
  });

  const withSomethingNew = shows.filter((s) => s.unheard > 0).length;

  return (
    <PageShell>
      <PageHeader
        title="Library"
        description={
          shows.length === 0
            ? "Shows you follow will appear here."
            : `${shows.length} show${shows.length === 1 ? "" : "s"} you follow.${
                withSomethingNew > 0
                  ? ` ${withSomethingNew} ${
                      withSomethingNew === 1 ? "has" : "have"
                    } something new.`
                  : ""
              }`
        }
        action={
          shows.length > 0 ? (
            <Link href="/discover">
              <Button size="sm" variant="secondary">
                Add a show
              </Button>
            </Link>
          ) : undefined
        }
      />

      {shows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            Icon={Library}
            title="No subscriptions yet"
            description="Search for a show, or paste an RSS feed URL directly — both work, and neither is buried behind a menu."
            action={
              <Link href="/discover">
                <Button>Find podcasts</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <ShowGrid shows={shows} />
      )}
    </PageShell>
  );
}
