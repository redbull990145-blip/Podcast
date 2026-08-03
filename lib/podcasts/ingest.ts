import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { episodes, podcasts, type Podcast } from "@/lib/db/schema";
import { fetchFeed, type ParsedEpisode, type ParsedFeed } from "@/lib/rss/parse-feed";

/**
 * Turns a feed URL into rows in our catalogue cache.
 *
 * The cache is shared across all users: two people subscribing to the same show
 * hit the same `podcasts` row, so a popular feed is fetched once rather than
 * once per subscriber.
 */

/**
 * Feeds occasionally carry thousands of items. Ingesting all of them would blow
 * the function's time budget and bloat a 500MB free-tier database for episodes
 * nobody will open. The publisher orders newest-first, so this keeps the part
 * people actually listen to.
 *
 * Raised from 500, which was cutting real shows: a long-running weekly is past
 * a thousand episodes and several in this library sit just over the old figure
 * — BibleProject publishes 535 — so the cap was silently deciding that the
 * back catalogue did not exist. At roughly 2KB a row this is about 2MB for the
 * largest feed anyone is likely to add, which the free tier absorbs.
 *
 * It is still a cap rather than "all of them", because the failure mode at the
 * far end is worse than a truncated list: a feed with ten thousand items would
 * take the ingest past the function's time budget and leave the show
 * half-written. `episodesAvailable` reports what the feed offered, so when this
 * does bite the page can say so instead of quietly showing less.
 */
const MAX_EPISODES_PER_FEED = 2000;

/** Postgres caps bound parameters per statement; chunking keeps us clear of it. */
const INSERT_CHUNK_SIZE = 100;

/** How long a cached feed is considered fresh enough to skip a refetch. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

export type IngestResult =
  | {
      status: "ok";
      podcast: Podcast;
      /** Episodes now stored for this show. */
      episodeCount: number;
      /**
       * What the feed offered on this pass — items carrying audio, and items
       * of any kind. Absent when nothing was fetched (a cache hit, or a 304).
       *
       * Both numbers are needed to tell the two silent failures apart. A blog
       * feed has items and no audio; a dead feed has neither. They produce the
       * same empty show and need completely different explanations.
       */
      feed?: { audioItems: number; totalItems: number };
    }
  | { status: "error"; message: string };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function upsertEpisodes(podcastId: string, parsed: ParsedEpisode[]) {
  if (parsed.length === 0) return 0;

  // Newest first, then capped — publishers usually order this way already, but
  // a few append new episodes at the end.
  const ordered = [...parsed].sort((a, b) => {
    const at = a.publishedAt?.getTime() ?? 0;
    const bt = b.publishedAt?.getTime() ?? 0;
    return bt - at;
  });

  // A feed can repeat a guid (usually a publishing mistake). Postgres rejects a
  // statement that touches the same conflict target twice, so dedupe first.
  const seen = new Set<string>();
  const unique = ordered.filter((e) => {
    if (seen.has(e.guid)) return false;
    seen.add(e.guid);
    return true;
  });

  const capped = unique.slice(0, MAX_EPISODES_PER_FEED);

  for (const batch of chunk(capped, INSERT_CHUNK_SIZE)) {
    await db
      .insert(episodes)
      .values(
        batch.map((e) => ({
          podcastId,
          guid: e.guid,
          title: e.title,
          description: e.description,
          enclosureUrl: e.enclosureUrl,
          enclosureType: e.enclosureType,
          enclosureLength: e.enclosureLength,
          durationSeconds: e.durationSeconds,
          episodeNumber: e.episodeNumber,
          seasonNumber: e.seasonNumber,
          imageUrl: e.imageUrl,
          publishedAt: e.publishedAt,
          transcriptUrl: e.transcriptUrl,
          chaptersUrl: e.chaptersUrl,
        })),
      )
      .onConflictDoUpdate({
        target: [episodes.podcastId, episodes.guid],
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          enclosureUrl: sql`excluded.enclosure_url`,
          enclosureType: sql`excluded.enclosure_type`,
          enclosureLength: sql`excluded.enclosure_length`,
          durationSeconds: sql`excluded.duration_seconds`,
          episodeNumber: sql`excluded.episode_number`,
          seasonNumber: sql`excluded.season_number`,
          imageUrl: sql`excluded.image_url`,
          publishedAt: sql`excluded.published_at`,
          transcriptUrl: sql`excluded.transcript_url`,
          chaptersUrl: sql`excluded.chapters_url`,
          // chapters and chapters_source are deliberately not overwritten: an
          // AI-generated set would otherwise be wiped on every refresh.
        },
      });
  }

  return capped.length;
}

async function upsertPodcast(
  feedUrl: string,
  feed: ParsedFeed,
  http: { etag: string | null; lastModified: string | null },
  ids?: { itunesId?: number | null; podcastindexId?: number | null },
): Promise<Podcast> {
  const [row] = await db
    .insert(podcasts)
    .values({
      feedUrl,
      title: feed.title,
      author: feed.author,
      description: feed.description,
      artworkUrl: feed.artworkUrl,
      categories: feed.categories,
      language: feed.language,
      link: feed.link,
      itunesId: ids?.itunesId ?? null,
      podcastindexId: ids?.podcastindexId ?? null,
      lastFetchedAt: new Date(),
      lastBuildDate: feed.lastBuildDate,
      etag: http.etag,
      lastModified: http.lastModified,
    })
    .onConflictDoUpdate({
      target: podcasts.feedUrl,
      set: {
        title: sql`excluded.title`,
        author: sql`excluded.author`,
        description: sql`excluded.description`,
        artworkUrl: sql`excluded.artwork_url`,
        categories: sql`excluded.categories`,
        language: sql`excluded.language`,
        link: sql`excluded.link`,
        lastFetchedAt: sql`excluded.last_fetched_at`,
        lastBuildDate: sql`excluded.last_build_date`,
        etag: sql`excluded.etag`,
        lastModified: sql`excluded.last_modified`,
        // Catalogue ids are only ever filled in, never cleared — a refresh from
        // a raw feed URL has no ids and must not erase ones we already learned.
        itunesId: sql`coalesce(excluded.itunes_id, ${podcasts.itunesId})`,
        podcastindexId: sql`coalesce(excluded.podcastindex_id, ${podcasts.podcastindexId})`,
      },
    })
    .returning();

  return row;
}

/**
 * Fetches a feed and writes it to the catalogue.
 *
 * Safe to call repeatedly — it upserts, and skips the network entirely when a
 * recently-fetched copy is already cached.
 */
export async function ingestFeed(
  feedUrl: string,
  options: {
    force?: boolean;
    itunesId?: number | null;
    podcastindexId?: number | null;
  } = {},
): Promise<IngestResult> {
  const existing = await db.query.podcasts.findFirst({
    where: eq(podcasts.feedUrl, feedUrl),
  });

  if (!options.force && existing?.lastFetchedAt) {
    const age = Date.now() - existing.lastFetchedAt.getTime();
    if (age < REFRESH_AFTER_MS) {
      return {
        status: "ok",
        podcast: existing,
        episodeCount: await countEpisodes(existing.id),
      };
    }
  }

  const result = await fetchFeed(feedUrl, {
    etag: existing?.etag,
    lastModified: existing?.lastModified,
  });

  if (result.status === "not-modified" && existing) {
    // Nothing changed upstream. Record that we checked so we do not ask again
    // for another hour, and skip the parse and all writes.
    await db
      .update(podcasts)
      .set({ lastFetchedAt: new Date() })
      .where(eq(podcasts.id, existing.id));

    return {
      status: "ok",
      podcast: existing,
      episodeCount: await countEpisodes(existing.id),
    };
  }

  if (result.status !== "ok") {
    // A refresh failure on a feed we already have should not break the page —
    // serve what is cached and try again next time.
    if (existing) {
      return {
        status: "ok",
        podcast: existing,
        episodeCount: await countEpisodes(existing.id),
      };
    }
    return {
      status: "error",
      message: result.status === "error" ? result.message : "Couldn't read that feed.",
    };
  }

  const podcast = await upsertPodcast(
    feedUrl,
    result.feed,
    { etag: result.etag, lastModified: result.lastModified },
    { itunesId: options.itunesId, podcastindexId: options.podcastindexId },
  );

  await upsertEpisodes(podcast.id, result.feed.episodes);

  /*
   * Counted from the table rather than taken from what this pass wrote.
   * `upsertEpisodes` returns how many rows it touched, which is not the same as
   * how many the show has: feeds routinely publish a rolling window of the most
   * recent fifty, so a refresh writes fifty and the show still has six hundred.
   * Reporting the write count made an established show look like it had shrunk.
   */
  const episodeCount = await countEpisodes(podcast.id);

  return {
    status: "ok",
    podcast,
    episodeCount,
    feed: {
      audioItems: result.feed.episodes.length,
      totalItems: result.feed.itemCount,
    },
  };
}

/** How many episodes are stored for a show. */
export async function countEpisodes(podcastId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(episodes)
    .where(eq(episodes.podcastId, podcastId));
  return count;
}

/** Refreshes a show we already know about, by id. */
export async function refreshPodcast(podcastId: string): Promise<IngestResult> {
  const existing = await db.query.podcasts.findFirst({
    where: eq(podcasts.id, podcastId),
  });
  if (!existing) return { status: "error", message: "Unknown podcast." };
  return ingestFeed(existing.feedUrl, { force: true });
}

/** Looks up a cached episode with its show, for the player and episode page. */
export async function getEpisodeWithPodcast(episodeId: string) {
  return db.query.episodes.findFirst({
    where: eq(episodes.id, episodeId),
    with: { podcast: true },
  });
}

/** Episodes for a show, newest first. */
export async function listEpisodes(podcastId: string, limit = 50, offset = 0) {
  return db.query.episodes.findMany({
    where: eq(episodes.podcastId, podcastId),
    orderBy: (e, { desc }) => [desc(e.publishedAt)],
    limit,
    offset,
  });
}

/**
 * Records a show we only know from a catalogue search, without fetching its feed.
 *
 * Dismissing a recommendation has to point at a `podcasts` row, but the show
 * may never have been opened here — and pulling a whole feed just to remember
 * "not interested" would be absurd. This writes the little the catalogue gave
 * us and leaves `lastFetchedAt` null, so the first real visit still ingests it
 * properly rather than treating the stub as fresh.
 */
export async function ensureCatalogPodcast(input: {
  feedUrl: string;
  title: string;
  author?: string | null;
  artworkUrl?: string | null;
  categories?: string[];
  itunesId?: number | null;
  podcastindexId?: number | null;
}): Promise<Podcast> {
  const [row] = await db
    .insert(podcasts)
    .values({
      feedUrl: input.feedUrl,
      title: input.title,
      author: input.author ?? null,
      artworkUrl: input.artworkUrl ?? null,
      categories: input.categories ?? [],
      itunesId: input.itunesId ?? null,
      podcastindexId: input.podcastindexId ?? null,
    })
    .onConflictDoUpdate({
      target: podcasts.feedUrl,
      // Nothing to update — the existing row is always at least as good as a
      // stub — but Postgres needs an action to return the conflicting row.
      set: { feedUrl: sql`excluded.feed_url` },
    })
    .returning();

  return row;
}

/** Used by the subscribe flow to confirm a show exists before linking to it. */
export async function findPodcastByFeedUrl(feedUrl: string) {
  return db.query.podcasts.findFirst({ where: eq(podcasts.feedUrl, feedUrl) });
}

export async function isSubscribed(userId: string, podcastId: string) {
  const row = await db.query.subscriptions.findFirst({
    where: (s) => and(eq(s.userId, userId), eq(s.podcastId, podcastId)),
  });
  return Boolean(row);
}
