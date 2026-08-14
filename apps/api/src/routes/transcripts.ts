/**
 * Transcripts, fetched from the publisher on first read.
 *
 * Lazily rather than at ingest: one seed run produces thousands of episodes,
 * and fetching a caption file for each would be thousands of requests to
 * publishers' CDNs for transcripts nobody has opened. The first reader pays
 * once; everyone after reads the cached row.
 *
 * The fetch goes through `fetchFeed`, which is not a misnomer worth fixing —
 * it is the guarded fetcher, and a transcript URL is exactly as attacker-
 * controllable as a feed URL. It comes out of RSS that anyone can point at
 * anything, so it gets the same SSRF checks, the same redirect re-validation
 * and the same size cap.
 */

import { episodes, transcripts } from '@cue/db';
import type { Transcript } from '@cue/types';
import { uuidParam } from '@cue/validation';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { fetchFeed } from '../feed/fetch.ts';
import {
  isTimed,
  looksLikeTranscript,
  parseHtmlTranscript,
  parseTranscript,
} from '../feed/transcript.ts';
import { notFound, ok } from '../errors.ts';
import { rateLimit } from '../rate-limit.ts';

/**
 * How long a failure stands before we try the publisher again.
 *
 * Failures are cached deliberately. A dead transcript URL that is re-fetched
 * on every page view turns one publisher's broken link into a request per
 * reader — and the answer, an empty state, is the same every time.
 */
const FAILURE_TTL_MS = 24 * 60 * 60 * 1000;

export function transcriptRoutes(app: FastifyInstance): void {
  app.get(
    '/episodes/:id/transcript',
    { preHandler: rateLimit(app, 'expensive') },
    async (request) => {
      const { id } = uuidParam.parse(request.params);

      const [episode] = await app.db
        .select()
        .from(episodes)
        .where(eq(episodes.id, id))
        .limit(1);

      if (!episode) throw notFound('Episode');

      const [cached] = await app.db
        .select()
        .from(transcripts)
        .where(eq(transcripts.episodeId, id))
        .limit(1);

      const stale =
        cached?.status === 'failed' &&
        Date.now() - cached.fetchedAt.getTime() > FAILURE_TTL_MS;

      if (cached && !stale) {
        return ok({ transcript: toWire(cached), detail: cached.detail });
      }

      // The publisher offers none. Distinct from "we tried and failed", and the
      // empty state says something different for each.
      if (!episode.transcriptUrl) return ok({ transcript: null, detail: null });

      const outcome = await fetchFeed(episode.transcriptUrl);

      if (outcome.status !== 'ok') {
        const detail =
          outcome.status === 'gone'
            ? 'The publisher’s transcript is no longer at that address'
            : 'Could not reach the publisher’s transcript';

        const row = await store(app, id, [], 'failed', detail, null);
        return ok({ transcript: toWire(row), detail });
      }

      /**
       * Captions if the body carries cue timings, prose otherwise.
       *
       * Decided from the content rather than from the `type` attribute or the
       * response header, both of which publishers get wrong often enough that
       * trusting them would drop real transcripts. An error page served with a
       * 200 — which CDNs do constantly — parses to nothing either way and falls
       * into the empty case below.
       */
      const segments = looksLikeTranscript(outcome.body)
        ? parseTranscript(outcome.body)
        : parseHtmlTranscript(outcome.body);

      if (segments.length === 0) {
        const detail = 'The publisher’s transcript had no readable lines';
        const row = await store(app, id, [], 'failed', detail, null);
        return ok({ transcript: toWire(row), detail });
      }

      const row = await store(app, id, segments, 'ready', null, null);
      return ok({ transcript: toWire(row), detail: null });
    },
  );
}

async function store(
  app: FastifyInstance,
  episodeId: string,
  segments: Transcript['segments'],
  status: 'ready' | 'failed',
  detail: string | null,
  language: string | null,
) {
  const values = {
    episodeId,
    source: 'feed' as const,
    status,
    detail,
    language: language ?? 'en',
    segments,
    fetchedAt: new Date(),
  };

  // Upsert rather than insert: two readers opening the same episode at once
  // both get here, and the loser of that race must not 500.
  const [row] = await app.db
    .insert(transcripts)
    .values(values)
    .onConflictDoUpdate({ target: transcripts.episodeId, set: values })
    .returning();

  return row!;
}

function toWire(row: {
  episodeId: string;
  source: string;
  status: string;
  language: string;
  segments: Transcript['segments'];
}): Transcript {
  return {
    episodeId: row.episodeId,
    source: row.source as Transcript['source'],
    status: row.status as Transcript['status'],
    language: row.language,
    timed: isTimed(row.segments),
    segments: row.segments,
  };
}
