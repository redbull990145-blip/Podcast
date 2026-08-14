/**
 * The signed-in user's library.
 *
 * Every query here is scoped by `requireUser(request).id` — the id comes from
 * the verified session and never from the request. That is the authorization
 * boundary for this API, standing in for the row-level security that cannot
 * apply when the server connects with a privileged role.
 */

import {
  clampLimit,
  episodes,
  decodeCursor,
  encodeCursor,
  paginate,
  podcasts,
  subscriptions,
} from '@cue/db';
import { paginationQuery, uuidParam } from '@cue/validation';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/plugin.ts';
import { serializePodcast } from '../catalog/serialize.ts';
import { notFound, ok } from '../errors.ts';

export function libraryRoutes(app: FastifyInstance): void {
  /** Who am I? Used by both clients to decide what to render. */
  app.get('/me', async (request) => {
    // Deliberately not 401 for anonymous callers: "are you signed in?" is a
    // legitimate question with a legitimate negative answer, and answering it
    // with an error makes every client treat a normal state as a failure.
    return ok({ user: request.user });
  });

  /**
   * The user's shows, most recently subscribed first.
   *
   * One join rather than a query per show — the classic N+1 here would be
   * fetching subscription rows and then looking up each podcast.
   */
  app.get('/me/subscriptions', async (request) => {
    const user = requireUser(request);
    const query = paginationQuery.parse(request.query);
    const limit = clampLimit(query.limit);

    const cursor = decodeCursor(query.cursor);
    const keyset = cursor
      ? or(
          lt(subscriptions.subscribedAt, new Date(cursor.sortValue)),
          and(
            eq(subscriptions.subscribedAt, new Date(cursor.sortValue)),
            lt(subscriptions.podcastId, cursor.id),
          ),
        )
      : undefined;

    const scope = eq(subscriptions.userId, user.id);

    const rows = await app.db
      .select({
        podcast: podcasts,
        subscribedAt: subscriptions.subscribedAt,
        /**
         * How many episodes landed since this user subscribed.
         *
         * A correlated count rather than a second round trip per show — the
         * N+1 this shape exists to avoid. It reads the same
         * `(podcast_id, published_at DESC)` index the episode list uses.
         */
        newEpisodeCount: sql<number>`(
          SELECT count(*) FROM ${episodes}
          WHERE ${episodes.podcastId} = ${podcasts.id}
            AND ${episodes.publishedAt} > ${subscriptions.subscribedAt}
        )`.mapWith(Number),
      })
      .from(subscriptions)
      .innerJoin(podcasts, eq(podcasts.id, subscriptions.podcastId))
      .where(keyset ? and(scope, keyset) : scope)
      .orderBy(desc(subscriptions.subscribedAt), desc(subscriptions.podcastId))
      .limit(limit + 1);

    const page = paginate(rows, limit, (row) =>
      encodeCursor(row.subscribedAt, row.podcast.id),
    );

    return ok({
      items: page.items.map((row) => ({
        ...serializePodcast(row.podcast),
        subscribedAt: row.subscribedAt.toISOString(),
        newEpisodeCount: row.newEpisodeCount,
      })),
      nextCursor: page.nextCursor,
    });
  });

  /**
   * Subscribe.
   *
   * Idempotent by design: the button is optimistic, so a double tap or a
   * retried request must return success rather than a conflict the UI would
   * have to interpret as failure and roll back.
   */
  app.put('/me/subscriptions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    const [exists] = await app.db
      .select({ id: podcasts.id })
      .from(podcasts)
      .where(eq(podcasts.id, id))
      .limit(1);

    if (!exists) throw notFound('Podcast');

    await app.db
      .insert(subscriptions)
      .values({ userId: user.id, podcastId: id })
      .onConflictDoNothing({
        target: [subscriptions.userId, subscriptions.podcastId],
      });

    return ok({ subscribed: true });
  });

  /** Unsubscribe. Also idempotent — removing what isn't there is success. */
  app.delete('/me/subscriptions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    await app.db
      .delete(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.podcastId, id)));

    return ok({ subscribed: false });
  });

  /** Whether the current user follows a given show. */
  app.get('/me/subscriptions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = uuidParam.parse(request.params);

    const [row] = await app.db
      .select({ podcastId: subscriptions.podcastId })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.podcastId, id)))
      .limit(1);

    return ok({ subscribed: row !== undefined });
  });
}
