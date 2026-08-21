/**
 * Playback position and queue.
 *
 * The write path here is the one users notice when it goes wrong: a lost
 * position means losing your place in a two-hour episode. Two properties keep
 * it honest.
 *
 * **Reconciliation happens server-side.** Clients report what they observed;
 * the server decides what is true, using the same tested rules the player uses
 * locally. If the client decided, two devices would each believe their own
 * version and the last one to sync would always win.
 *
 * **Writes are idempotent and safe to retry.** Progress is reported every ~15
 * seconds from possibly-flaky networks, so a duplicate or out-of-order write
 * must never corrupt the record.
 */

import {
  categories,
  episodes,
  playbackProgress,
  podcastCategories,
  podcasts,
  queueItems,
} from '@cue/db';
import { generateKey, reconcileProgress, type ProgressRecord } from '@cue/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/plugin.ts';
import { serializeEpisode } from '../catalog/serialize.ts';
import { badRequest, notFound, ok } from '../errors.ts';

const progressInput = z.object({
  positionSec: z.number().min(0).max(24 * 60 * 60),
  durationSec: z.number().min(0).max(24 * 60 * 60).nullable().optional(),
  completed: z.boolean().optional(),
  /** Identifies the writing device so concurrent writes can be told apart. */
  deviceId: z.string().min(1).max(64),
  /**
   * When the client observed this position. Accepted from the client because
   * a position reported after twenty seconds offline was true when it was
   * measured, not when it finally arrived.
   */
  observedAt: z.number().int().positive().optional(),
});

const queueInput = z.object({
  episodeId: z.uuid(),
  /** Front of the queue rather than the end. */
  playNext: z.boolean().optional(),
});

const reorderInput = z.object({
  episodeIds: z.array(z.uuid()).min(1).max(500),
});

function toRecord(row: {
  positionSec: number;
  durationSec: number | null;
  completed: boolean;
  deviceId: string;
  updatedAt: Date;
}): ProgressRecord {
  return {
    positionSec: row.positionSec,
    durationSec: row.durationSec,
    completed: row.completed,
    deviceId: row.deviceId,
    updatedAt: row.updatedAt.getTime(),
  };
}

export function playbackRoutes(app: FastifyInstance): void {
  /**
   * Report a position.
   *
   * Reads the stored record, reconciles, and writes only if the incoming one
   * wins — so a stale straggler from a device left paused cannot rewind a
   * device that was genuinely further ahead.
   */
  app.put('/me/progress/:id', async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = progressInput.parse(request.body);

    const [exists] = await app.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, id))
      .limit(1);
    if (!exists) throw notFound('Episode');

    const [stored] = await app.db
      .select()
      .from(playbackProgress)
      .where(and(eq(playbackProgress.userId, user.id), eq(playbackProgress.episodeId, id)))
      .limit(1);

    const incoming: ProgressRecord = {
      positionSec: Math.round(input.positionSec),
      /*
        Rounded for the same reason `positionSec` is: the column is an integer
        and the client's number never is. `HTMLMediaElement.duration` is a
        float on essentially every browser and every file — 1882.122449 for a
        typical MP3 — so this write failed with a Postgres type error on
        nearly every real report, silently, because the client swallows a
        failed progress write rather than surface it (a dropped position
        report is not worth interrupting listening for). The device sending it
        never knew; the server logged "unhandled error" and 500ed every few
        seconds for as long as anything played.
      */
      durationSec: input.durationSec === null || input.durationSec === undefined
        ? null
        : Math.round(input.durationSec),
      completed: input.completed ?? false,
      deviceId: input.deviceId,
      // A client clock ahead of ours would let one device win every race, so
      // a claimed future timestamp is pulled back to now.
      updatedAt: Math.min(input.observedAt ?? Date.now(), Date.now()),
    };

    const decision = reconcileProgress(incoming, stored ? toRecord(stored) : null);
    const winner = decision?.winner ?? incoming;

    await app.db
      .insert(playbackProgress)
      .values({
        userId: user.id,
        episodeId: id,
        positionSec: winner.positionSec,
        durationSec: winner.durationSec,
        completed: winner.completed,
        deviceId: winner.deviceId,
        updatedAt: new Date(winner.updatedAt),
      })
      .onConflictDoUpdate({
        target: [playbackProgress.userId, playbackProgress.episodeId],
        set: {
          positionSec: winner.positionSec,
          durationSec: winner.durationSec,
          completed: winner.completed,
          deviceId: winner.deviceId,
          updatedAt: new Date(winner.updatedAt),
        },
      });

    // Return the resolved truth, not an acknowledgement: a client that lost
    // the reconciliation learns its real position in the same round trip.
    return ok({
      progress: {
        episodeId: id,
        positionSec: winner.positionSec,
        durationSec: winner.durationSec,
        completed: winner.completed,
        deviceId: winner.deviceId,
        updatedAt: new Date(winner.updatedAt).toISOString(),
      },
      /** True when the server kept a different record than the one sent. */
      superseded: winner.deviceId !== incoming.deviceId || winner.positionSec !== incoming.positionSec,
    });
  });

  app.get('/me/progress/:id', async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await app.db
      .select()
      .from(playbackProgress)
      .where(and(eq(playbackProgress.userId, user.id), eq(playbackProgress.episodeId, id)))
      .limit(1);

    return ok({
      progress: row
        ? {
            episodeId: id,
            positionSec: row.positionSec,
            durationSec: row.durationSec,
            completed: row.completed,
            deviceId: row.deviceId,
            updatedAt: row.updatedAt.toISOString(),
          }
        : null,
    });
  });

  /**
   * Continue listening: unfinished episodes, most recently touched first.
   *
   * One join rather than a lookup per row — this feeds the home screen, where
   * an N+1 would be most visible.
   */
  app.get('/me/continue', async (request) => {
    const user = requireUser(request);
    const limit = z.coerce.number().int().min(1).max(50).default(10).parse(
      (request.query as { limit?: unknown }).limit ?? 10,
    );

    const rows = await app.db
      .select({
        episode: episodes,
        podcast: podcasts,
        positionSec: playbackProgress.positionSec,
        durationSec: playbackProgress.durationSec,
        updatedAt: playbackProgress.updatedAt,
      })
      .from(playbackProgress)
      .innerJoin(episodes, eq(episodes.id, playbackProgress.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(and(eq(playbackProgress.userId, user.id), eq(playbackProgress.completed, false)))
      .orderBy(desc(playbackProgress.updatedAt))
      .limit(limit);

    return ok({
      items: rows.map((row) => ({
        episode: serializeEpisode(row.episode),
        podcastTitle: row.podcast.title,
        podcastArtworkUrl: row.podcast.artworkUrl,
        accentColor: row.podcast.accentColor,
        positionSec: row.positionSec,
        durationSec: row.durationSec ?? row.episode.durationSec,
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  });

  /**
   * Recently played: what was on, most recent first.
   *
   * The sibling of `/me/continue`, and deliberately not the same endpoint with
   * a flag. Continue answers *what should I finish* and therefore has to
   * exclude anything already finished; this answers *what have I been
   * listening to*, where a finished episode is the most interesting kind of
   * row there is. Two questions, two shapes, and merging them would mean every
   * caller passing a boolean to say which one it meant.
   *
   * One row per episode, because that is what the progress table stores — an
   * episode played twice moved its position and its timestamp rather than
   * appending a second row. So this is a list of *episodes recently played*,
   * not a play log, and it cannot answer "how many times".
   */
  app.get('/me/history', async (request) => {
    const user = requireUser(request);
    const limit = z.coerce.number().int().min(1).max(50).default(10).parse(
      (request.query as { limit?: unknown }).limit ?? 10,
    );

    const rows = await app.db
      .select({
        episode: episodes,
        podcast: podcasts,
        positionSec: playbackProgress.positionSec,
        durationSec: playbackProgress.durationSec,
        completed: playbackProgress.completed,
        updatedAt: playbackProgress.updatedAt,
      })
      .from(playbackProgress)
      .innerJoin(episodes, eq(episodes.id, playbackProgress.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(eq(playbackProgress.userId, user.id))
      .orderBy(desc(playbackProgress.updatedAt))
      .limit(limit);

    return ok({
      items: rows.map((row) => ({
        episode: serializeEpisode(row.episode),
        podcastTitle: row.podcast.title,
        podcastArtworkUrl: row.podcast.artworkUrl,
        accentColor: row.podcast.accentColor,
        positionSec: row.positionSec,
        durationSec: row.durationSec ?? row.episode.durationSec,
        completed: row.completed,
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  });

  /**
   * What this listener has actually done, in four numbers and a shortlist.
   *
   * **`positionSec` is a high-water mark, not a stopwatch.** The progress table
   * stores the furthest point reached in each episode, because that is what
   * resuming needs; nothing anywhere counts seconds of audio actually played.
   * So "time listened" here is the sum of those marks — it over-counts anyone
   * who skips forward and under-counts anyone who replays. It is the honest
   * available figure and it is close enough to be worth showing, but it is not
   * a play log and must never be presented as one.
   *
   * Three queries rather than one with several `GROUP BY`s stapled together:
   * the totals, the leading show, and the leading categories are different
   * shapes, and a single query producing all three would either repeat the
   * scan anyway or return a cross-product somebody has to unpick in JS.
   */
  app.get('/me/stats', async (request) => {
    const user = requireUser(request);
    const scope = eq(playbackProgress.userId, user.id);

    const [totals] = await app.db
      .select({
        listenedSec: sql<number>`coalesce(sum(${playbackProgress.positionSec}), 0)::int`,
        episodesStarted: sql<number>`count(*)::int`,
        episodesFinished: sql<number>`count(*) filter (where ${playbackProgress.completed})::int`,
        showCount: sql<number>`count(distinct ${episodes.podcastId})::int`,
      })
      .from(playbackProgress)
      .innerJoin(episodes, eq(episodes.id, playbackProgress.episodeId))
      .where(scope);

    // The show with the most time against it — "who you have been listening
    // to", which is a more human answer than any total.
    const [topShow] = await app.db
      .select({
        id: podcasts.id,
        title: podcasts.title,
        author: podcasts.author,
        artworkUrl: podcasts.artworkUrl,
        listenedSec: sql<number>`sum(${playbackProgress.positionSec})::int`,
      })
      .from(playbackProgress)
      .innerJoin(episodes, eq(episodes.id, playbackProgress.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(scope)
      .groupBy(podcasts.id, podcasts.title, podcasts.author, podcasts.artworkUrl)
      .orderBy(sql`sum(${playbackProgress.positionSec}) DESC`)
      .limit(1);

    /*
      Categories, by time rather than by episode count.

      A show tagged with three categories contributes its time to all three, so
      these deliberately do not sum to the total and are not rendered as a
      share of one. Forcing them to add up would mean inventing a rule for
      splitting a single episode across its tags, and any such rule is a guess
      presented as arithmetic.
    */
    const topCategories = await app.db
      .select({
        name: categories.name,
        listenedSec: sql<number>`sum(${playbackProgress.positionSec})::int`,
      })
      .from(playbackProgress)
      .innerJoin(episodes, eq(episodes.id, playbackProgress.episodeId))
      .innerJoin(podcastCategories, eq(podcastCategories.podcastId, episodes.podcastId))
      .innerJoin(categories, eq(categories.id, podcastCategories.categoryId))
      .where(scope)
      .groupBy(categories.name)
      .orderBy(sql`sum(${playbackProgress.positionSec}) DESC`)
      .limit(3);

    return ok({
      listenedSec: totals?.listenedSec ?? 0,
      episodesStarted: totals?.episodesStarted ?? 0,
      episodesFinished: totals?.episodesFinished ?? 0,
      showCount: totals?.showCount ?? 0,
      topShow: topShow
        ? {
            id: topShow.id,
            title: topShow.title,
            author: topShow.author,
            artworkUrl: topShow.artworkUrl,
            listenedSec: topShow.listenedSec,
          }
        : null,
      topCategories,
    });
  });

  // ---------------------------------------------------------------- queue --

  app.get('/me/queue', async (request) => {
    const user = requireUser(request);

    const rows = await app.db
      .select({ episode: episodes, podcast: podcasts, sortKey: queueItems.sortKey })
      .from(queueItems)
      .innerJoin(episodes, eq(episodes.id, queueItems.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(eq(queueItems.userId, user.id))
      .orderBy(asc(queueItems.sortKey));

    return ok({
      items: rows.map((row) => ({
        episode: serializeEpisode(row.episode),
        podcastTitle: row.podcast.title,
        podcastArtworkUrl: row.podcast.artworkUrl,
        accentColor: row.podcast.accentColor,
      })),
    });
  });

  app.post('/me/queue', async (request) => {
    const user = requireUser(request);
    const input = queueInput.parse(request.body);

    const [exists] = await app.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, input.episodeId))
      .limit(1);
    if (!exists) throw notFound('Episode');

    // Only the neighbouring key is needed to place the new item, not the whole
    // queue — that is the point of fractional indexing.
    const [neighbour] = await app.db
      .select({ sortKey: queueItems.sortKey })
      .from(queueItems)
      .where(eq(queueItems.userId, user.id))
      .orderBy(input.playNext ? asc(queueItems.sortKey) : desc(queueItems.sortKey))
      .limit(1);

    const sortKey = input.playNext
      ? generateKey(null, neighbour?.sortKey ?? null)
      : generateKey(neighbour?.sortKey ?? null, null);

    await app.db
      .insert(queueItems)
      .values({ userId: user.id, episodeId: input.episodeId, sortKey })
      // Already queued is success, not a conflict — the button is optimistic.
      .onConflictDoNothing({ target: [queueItems.userId, queueItems.episodeId] });

    return ok({ queued: true });
  });

  app.delete('/me/queue/:id', async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    await app.db
      .delete(queueItems)
      .where(and(eq(queueItems.userId, user.id), eq(queueItems.episodeId, id)));

    return ok({ queued: false });
  });

  /**
   * Reorder.
   *
   * Takes the full intended order and rewrites keys. A drag reorders one item,
   * but sending the whole order makes the operation idempotent and immune to
   * two devices disagreeing about what the list looked like.
   */
  app.put('/me/queue/order', async (request) => {
    const user = requireUser(request);
    const input = reorderInput.parse(request.body);

    const owned = await app.db
      .select({ episodeId: queueItems.episodeId })
      .from(queueItems)
      .where(
        and(eq(queueItems.userId, user.id), inArray(queueItems.episodeId, input.episodeIds)),
      );

    const ownedIds = new Set(owned.map((row) => row.episodeId));
    const ordered = input.episodeIds.filter((id) => ownedIds.has(id));

    if (ordered.length === 0) throw badRequest('None of those episodes are in your queue');

    let previous: string | null = null;
    for (const episodeId of ordered) {
      const sortKey: string = generateKey(previous, null);
      await app.db
        .update(queueItems)
        .set({ sortKey })
        .where(and(eq(queueItems.userId, user.id), eq(queueItems.episodeId, episodeId)));
      previous = sortKey;
    }

    return ok({ reordered: ordered.length });
  });

  app.delete('/me/queue', async (request) => {
    const user = requireUser(request);
    await app.db.delete(queueItems).where(eq(queueItems.userId, user.id));
    return ok({ cleared: true });
  });
}
