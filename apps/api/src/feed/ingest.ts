/**
 * Ingest: fetch a feed, parse it, and reconcile it into the database.
 *
 * Two failure modes drive the design here:
 *
 *  - **Re-ingesting must update, not duplicate.** Every write is an upsert
 *    keyed on the same unique index the schema declares, so running this twice
 *    is indistinguishable from running it once.
 *  - **Big shows must land completely.** A long-running podcast can carry a
 *    thousand episodes, which is more bind parameters than Postgres accepts in
 *    one statement. Episodes are chunked; silently truncating at some page
 *    size is exactly how a show ends up "stuck" at a round number.
 */

import { episodes, podcasts, categories, podcastCategories, type Database } from '@cue/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { extractArtworkColor } from './artwork-color.ts';
import { fetchFeed } from './fetch.ts';
import { parseFeed, type ParsedEpisode } from './parse.ts';

/**
 * Rows per INSERT. Postgres caps a statement at 65535 bind parameters and an
 * episode binds ~18, so ~3600 would fit. 200 keeps each statement short enough
 * that one failure is cheap to retry.
 */
const EPISODE_CHUNK = 200;

/** Stop polling a feed that has failed this many times consecutively. */
export const MAX_FETCH_FAILURES = 10;

export type IngestResult =
  | {
      status: 'ingested';
      podcastId: string;
      episodesWritten: number;
      episodesSkipped: number;
      /** True when the publisher had nothing new but we refreshed bookkeeping. */
      unchanged: false;
    }
  | { status: 'unchanged'; podcastId: string }
  | { status: 'gone'; detail: string }
  | { status: 'failed'; detail: string; retryable: boolean };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function writeEpisodes(
  db: Database,
  podcastId: string,
  parsed: ParsedEpisode[],
): Promise<number> {
  let written = 0;

  for (const batch of chunk(parsed, EPISODE_CHUNK)) {
    const rows = batch.map((episode) => ({
      podcastId,
      guid: episode.guid,
      title: episode.title,
      description: episode.description,
      descriptionHtml: episode.descriptionHtml,
      audioUrl: episode.audioUrl,
      audioType: episode.audioType,
      audioLengthBytes: episode.audioLengthBytes,
      durationSec: episode.durationSec,
      publishedAt: episode.publishedAt,
      artworkUrl: episode.artworkUrl,
      episodeNumber: episode.episodeNumber,
      seasonNumber: episode.seasonNumber,
      explicit: episode.explicit,
      transcriptUrl: episode.transcriptUrl,
      transcriptType: episode.transcriptType,
    }));

    const result = await db
      .insert(episodes)
      .values(rows)
      .onConflictDoUpdate({
        target: [episodes.podcastId, episodes.guid],
        // Publishers edit titles, fix descriptions and re-host audio. Those
        // are corrections and should land. `publishedAt` is included because a
        // corrected date must re-sort; `createdAt` deliberately is not.
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          descriptionHtml: sql`excluded.description_html`,
          audioUrl: sql`excluded.audio_url`,
          audioType: sql`excluded.audio_type`,
          audioLengthBytes: sql`excluded.audio_length_bytes`,
          durationSec: sql`excluded.duration_sec`,
          publishedAt: sql`excluded.published_at`,
          artworkUrl: sql`excluded.artwork_url`,
          episodeNumber: sql`excluded.episode_number`,
          seasonNumber: sql`excluded.season_number`,
          explicit: sql`excluded.explicit`,
          transcriptUrl: sql`excluded.transcript_url`,
          transcriptType: sql`excluded.transcript_type`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: episodes.id });

    written += result.length;
  }

  return written;
}

async function linkCategories(db: Database, podcastId: string, names: string[]): Promise<void> {
  if (names.length === 0) return;

  const rows = names
    .map((name) => ({ slug: slugify(name), name }))
    .filter((row) => row.slug.length > 0);

  if (rows.length === 0) return;

  // Insert-or-ignore, then read back — `onConflictDoNothing` returns nothing
  // for rows that already existed, so the ids have to come from a select.
  await db.insert(categories).values(rows).onConflictDoNothing({ target: categories.slug });

  // `inArray`, not a hand-written `= ANY(...)`: interpolating a JS array into
  // raw SQL expands it to separate bind parameters, which Postgres reads as a
  // row constructor rather than an array and rejects outright.
  const slugs = rows.map((row) => row.slug);
  const existing = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(inArray(categories.slug, slugs));

  if (existing.length === 0) return;

  await db
    .insert(podcastCategories)
    .values(existing.map((category) => ({ podcastId, categoryId: category.id })))
    .onConflictDoNothing();
}

export type IngestOptions = {
  /** Skip the conditional-GET headers and re-read the whole feed. */
  force?: boolean;
  fetchImpl?: typeof fetch;
  /**
   * How this show reached us, recorded the first time we see it.
   *
   * Only ever applies on insert — the upsert below deliberately leaves the
   * column out of its `set`, so a nightly refresh of a seeded show cannot
   * relabel it as something a visitor found.
   */
  source?: 'seed' | 'directory';
};

export async function ingestFeed(
  db: Database,
  feedUrl: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const [existing] = await db
    .select({
      id: podcasts.id,
      etag: podcasts.etag,
      lastModified: podcasts.lastModified,
      artworkUrl: podcasts.artworkUrl,
      accentColor: podcasts.accentColor,
    })
    .from(podcasts)
    .where(eq(podcasts.feedUrl, feedUrl))
    .limit(1);

  const outcome = await fetchFeed(feedUrl, {
    // A conditional request turns an unchanged feed into a 304 with no body.
    // That is the difference between polling being free and being the bill.
    etag: options.force ? null : (existing?.etag ?? null),
    lastModified: options.force ? null : (existing?.lastModified ?? null),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  if (outcome.status === 'not-modified') {
    if (existing) {
      await db
        .update(podcasts)
        .set({ lastFetchedAt: new Date(), fetchFailureCount: 0 })
        .where(eq(podcasts.id, existing.id));
      return { status: 'unchanged', podcastId: existing.id };
    }
    return { status: 'failed', detail: 'Got 304 for a feed we have never read', retryable: true };
  }

  if (outcome.status === 'gone') {
    if (existing) {
      await db
        .update(podcasts)
        .set({ fetchFailureCount: MAX_FETCH_FAILURES, lastFetchedAt: new Date() })
        .where(eq(podcasts.id, existing.id));
    }
    return { status: 'gone', detail: outcome.detail };
  }

  if (outcome.status === 'error') {
    if (existing) {
      await db
        .update(podcasts)
        .set({
          fetchFailureCount: sql`${podcasts.fetchFailureCount} + 1`,
          lastFetchedAt: new Date(),
        })
        .where(eq(podcasts.id, existing.id));
    }
    return { status: 'failed', detail: outcome.detail, retryable: outcome.retryable };
  }

  const parsed = parseFeed(outcome.body);
  if (!parsed.ok) {
    if (existing) {
      await db
        .update(podcasts)
        .set({
          fetchFailureCount: sql`${podcasts.fetchFailureCount} + 1`,
          lastFetchedAt: new Date(),
        })
        .where(eq(podcasts.id, existing.id));
    }
    return { status: 'failed', detail: parsed.reason, retryable: false };
  }

  const latestPublishedAt = parsed.episodes.reduce<Date | null>(
    (latest, episode) =>
      latest === null || episode.publishedAt > latest ? episode.publishedAt : latest,
    null,
  );

  /**
   * Only re-read the artwork when the cover URL actually changed. Publishers
   * refresh feeds constantly and change covers rarely, so this keeps a routine
   * refresh from re-downloading and re-decoding an image it already knows.
   */
  const artworkChanged =
    existing === undefined || existing.artworkUrl !== parsed.podcast.artworkUrl;

  const accentColor = artworkChanged
    ? await extractArtworkColor(parsed.podcast.artworkUrl, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })
    : existing.accentColor;

  const now = new Date();
  const [row] = await db
    .insert(podcasts)
    .values({
      accentColor,
      source: options.source ?? 'seed',
      // Store the URL we ended up at, so a permanent redirect is followed once
      // rather than on every refresh.
      feedUrl: outcome.finalUrl,
      title: parsed.podcast.title,
      author: parsed.podcast.author,
      description: parsed.podcast.description,
      artworkUrl: parsed.podcast.artworkUrl,
      websiteUrl: parsed.podcast.websiteUrl,
      language: parsed.podcast.language,
      explicit: parsed.podcast.explicit,
      etag: outcome.etag,
      lastModified: outcome.lastModified,
      lastFetchedAt: now,
      lastPublishedAt: latestPublishedAt,
      episodeCount: parsed.episodes.length,
      fetchFailureCount: 0,
    })
    .onConflictDoUpdate({
      target: podcasts.feedUrl,
      set: {
        title: sql`excluded.title`,
        author: sql`excluded.author`,
        description: sql`excluded.description`,
        artworkUrl: sql`excluded.artwork_url`,
        websiteUrl: sql`excluded.website_url`,
        language: sql`excluded.language`,
        explicit: sql`excluded.explicit`,
        accentColor: sql`excluded.accent_color`,
        etag: sql`excluded.etag`,
        lastModified: sql`excluded.last_modified`,
        lastFetchedAt: sql`excluded.last_fetched_at`,
        lastPublishedAt: sql`excluded.last_published_at`,
        episodeCount: sql`excluded.episode_count`,
        fetchFailureCount: 0,
        updatedAt: now,
      },
    })
    .returning({ id: podcasts.id });

  if (!row) {
    return { status: 'failed', detail: 'Could not write the podcast', retryable: true };
  }

  const episodesWritten = await writeEpisodes(db, row.id, parsed.episodes);
  await linkCategories(db, row.id, parsed.podcast.categories);

  return {
    status: 'ingested',
    podcastId: row.id,
    episodesWritten,
    episodesSkipped: parsed.skipped,
    unchanged: false,
  };
}
