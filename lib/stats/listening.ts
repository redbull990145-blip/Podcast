import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  downloads,
  episodes,
  listeningHistory,
  playbackState,
  podcasts,
} from "@/lib/db/schema";
import {
  completedBetween,
  computeStreak,
  dailyBreakdown,
  topCategories,
  totalSeconds,
  type DayBucket,
  type ListenedRow,
} from "./summarise";

const DAY_MS = 86_400_000;

/** How far back the streak query looks. A longer streak than this reads as "99+". */
const STREAK_WINDOW_DAYS = 400;

export type ContinueItem = {
  episodeId: string;
  title: string;
  podcastId: string;
  podcastTitle: string;
  artworkUrl: string | null;
  enclosureUrl: string;
  durationSeconds: number | null;
  positionSeconds: number;
  categories: string[];
};

export type DashboardStats = {
  weekSeconds: number;
  previousWeekSeconds: number;
  daily: DayBucket[];
  completedThisWeek: number;
  completedLastWeek: number;
  categories: { name: string; seconds: number; share: number }[];
  streakDays: number;
  downloadCount: number;
  downloadBytes: number;
  continueListening: ContinueItem[];
};

/**
 * Everything the dashboard shows, in four queries.
 *
 * The fortnight of playback rows is fetched once and summarised in memory
 * rather than aggregated in four separate SQL passes: this week, last week, the
 * per-day chart and the category mix are all cuts of the same few hundred rows,
 * and one round trip to a hosted Postgres costs far more than the arithmetic.
 */
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const now = new Date();
  const fortnightAgo = new Date(now.getTime() - 14 * DAY_MS);

  const [recent, continueRows, downloadTotals, streakDays] = await Promise.all([
    db
      .select({
        lastPlayedAt: playbackState.lastPlayedAt,
        positionSeconds: playbackState.positionSeconds,
        durationSeconds: episodes.durationSeconds,
        played: playbackState.played,
        categories: podcasts.categories,
      })
      .from(playbackState)
      .innerJoin(episodes, eq(episodes.id, playbackState.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(
        and(
          eq(playbackState.userId, userId),
          gte(playbackState.lastPlayedAt, fortnightAgo),
        ),
      ),

    db
      .select({
        episodeId: episodes.id,
        title: episodes.title,
        podcastId: podcasts.id,
        podcastTitle: podcasts.title,
        episodeImage: episodes.imageUrl,
        podcastArtwork: podcasts.artworkUrl,
        enclosureUrl: episodes.enclosureUrl,
        durationSeconds: episodes.durationSeconds,
        positionSeconds: playbackState.positionSeconds,
        categories: podcasts.categories,
      })
      .from(playbackState)
      .innerJoin(episodes, eq(episodes.id, playbackState.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(
        and(
          eq(playbackState.userId, userId),
          eq(playbackState.played, false),
          gt(playbackState.positionSeconds, "0"),
        ),
      )
      .orderBy(desc(playbackState.lastPlayedAt))
      .limit(3),

    db
      .select({
        files: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${downloads.bytesDownloaded}), 0)::bigint`,
      })
      .from(downloads)
      .where(and(eq(downloads.userId, userId), eq(downloads.status, "complete"))),

    /*
     * Distinct days rather than raw events: the history table logs one row per
     * play, and a heavy weekend would otherwise pull hundreds of rows across
     * the wire to answer a question about which *days* had any activity at all.
     */
    db
      .selectDistinct({
        day: sql<string>`date_trunc('day', ${listeningHistory.occurredAt})`,
      })
      .from(listeningHistory)
      .where(
        and(
          eq(listeningHistory.userId, userId),
          gte(
            listeningHistory.occurredAt,
            new Date(now.getTime() - STREAK_WINDOW_DAYS * DAY_MS),
          ),
        ),
      ),
  ]);

  const rows: ListenedRow[] = recent.map((r) => ({
    // Narrowed for the summarisers: the column is nullable, but the query
    // filters on it being inside the window, so every row here has one.
    lastPlayedAt: r.lastPlayedAt ?? now,
    positionSeconds: Number(r.positionSeconds),
    durationSeconds: r.durationSeconds,
    played: r.played,
    categories: r.categories,
  }));

  return {
    weekSeconds: totalSeconds(rows, now, 7),
    previousWeekSeconds: totalSeconds(rows, now, 14) - totalSeconds(rows, now, 7),
    daily: dailyBreakdown(rows, now),
    completedThisWeek: completedBetween(rows, now, 7, 0),
    completedLastWeek: completedBetween(rows, now, 14, 7),
    categories: topCategories(rows, now),
    streakDays: computeStreak(
      streakDays.map((d) => new Date(d.day)),
      now,
    ),
    downloadCount: Number(downloadTotals[0]?.files ?? 0),
    downloadBytes: Number(downloadTotals[0]?.bytes ?? 0),
    continueListening: continueRows.map((r) => ({
      episodeId: r.episodeId,
      title: r.title,
      podcastId: r.podcastId,
      podcastTitle: r.podcastTitle,
      artworkUrl: r.episodeImage ?? r.podcastArtwork,
      enclosureUrl: r.enclosureUrl,
      durationSeconds: r.durationSeconds,
      positionSeconds: Number(r.positionSeconds),
      categories: r.categories,
    })),
  };
}
