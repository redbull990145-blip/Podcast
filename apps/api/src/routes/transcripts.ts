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

import { episodes, transcriptionJobs, transcripts, type TranscriptRow } from '@cue/db';
import type { Transcript, TranscriptAlignment } from '@cue/types';
import { uuidParam } from '@cue/validation';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { fetchFeed } from '../feed/fetch.ts';
import {
  isTimed,
  looksLikeTranscript,
  parseHtmlTranscript,
  parseTranscript,
} from '../feed/transcript.ts';
import { insertedAudio, readAudioShape } from '../ai/align/detect.ts';
import { applyOffsetMap } from '../ai/align/map.ts';
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

/**
 * How long the audio measurement may hold up a transcript request.
 *
 * The download path this borrows from allows ten minutes, which is right for
 * pulling three hundred megabytes and catastrophic here: this runs inside a
 * request a reader is waiting on, and the three reads it makes are a few hundred
 * bytes each. Anything past a few seconds is a CDN that is not going to answer,
 * and the correct outcome then is an unmeasured transcript rather than a request
 * that hangs until a proxy somewhere gives up on it.
 *
 * One budget across all three reads, not one each — the question is how long the
 * reader waits, not how long any single request took.
 */
const MEASURE_TIMEOUT_MS = 8000;

/**
 * How long the response will actually wait for that measurement.
 *
 * The enclosure URL is a redirect walk — `podtrac.com` to `traffic.omny.fm` to
 * `tritondigital.com` on the show this was built for — and each hop runs ad
 * decisioning rather than serving a file, so the first ranged read measured 5.1s
 * against 0.5s for the transcript itself. Blocking on that would make the reader
 * wait six seconds for the thing they asked for in order to populate a label
 * about it.
 *
 * So the measurement gets a short window to be useful *now*, and if it misses it
 * the request goes out without it and the row is updated when it lands. The
 * reader gets their transcript immediately; the drift warning appears on their
 * next visit, which is soon enough for something they will not have noticed yet.
 */
const MEASURE_SETTLE_MS = 2500;

/**
 * The generation of this file's parsing and measurement.
 *
 * Bump it whenever a change here would produce a different row from the same
 * publisher file, and cached rows below it are re-derived once on next read.
 * Without this a parser fix reaches only episodes nobody had opened yet, which
 * is the reverse of what is wanted — the popular ones are exactly the ones
 * already cached.
 *
 * History:
 *   1 — lift `Speaker N:` labels out of the caption text, and record what the
 *       cues were timed against so drift can be detected at all.
 */
const TRANSCRIPT_REVISION = 1;

// Keep the PostgreSQL timestamp precision; Date truncates historical microseconds.
type VersionedTranscriptRow = TranscriptRow & { fetchedAtVersion: string };
const versionedColumns = {
  ...getTableColumns(transcripts),
  fetchedAtVersion: sql<string>`to_char(${transcripts.fetchedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

export function transcriptRoutes(app: FastifyInstance): void {
  app.get(
    '/episodes/:id/transcript',
    { preHandler: rateLimit(app, 'expensive') },
    async (request) => {
      const { id } = uuidParam.parse(request.params);

      const [episode] = await app.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);

      if (!episode) throw notFound('Episode');

      const [cached] = await app.db
        .select(versionedColumns)
        .from(transcripts)
        .where(eq(transcripts.episodeId, id))
        .limit(1);

      /**
       * Two reasons to go back to the publisher.
       *
       * The revision check is deliberately limited to `feed` rows. A generated
       * transcript cost minutes of Whisper time and is not re-derivable from the
       * publisher at all — re-fetching one would replace real work with an empty
       * result, or with the publisher's own transcript, which is not the same
       * thing and is not what anyone asked for.
       */
      const outdated = cached?.source === 'feed' && cached.revision < TRANSCRIPT_REVISION;

      const stale =
        outdated ||
        (cached?.source === 'feed' &&
          cached.status === 'failed' &&
          Date.now() - cached.fetchedAt.getTime() > FAILURE_TTL_MS);

      if (cached && !stale) {
        return ok({ transcript: toWire(cached), detail: cached.detail });
      }

      // The publisher offers none. Distinct from "we tried and failed", and the
      // empty state says something different for each.
      if (!episode.transcriptUrl) return ok({ transcript: null, detail: null });

      /**
       * Fetch the transcript and measure the audio at the same time.
       *
       * They are independent — one reads the publisher's caption file, the other
       * reads three ranges of the enclosure — and both are round trips to CDNs
       * reached through a redirect walk. Run in sequence they cost the reader
       * the sum; run together they cost the slower of the two. Measured on
       * Elevation, sequential was 8.2s.
       *
       * The measurement is started before it is known whether the cues are timed,
       * which is the price of overlapping them, and a cheap one: an untimed HTML
       * transcript wastes two ranged reads that are thrown away below.
       */
      const startedAt = Date.now();
      const measurement = measureAudio(episode);
      const outcome = await fetchFeed(episode.transcriptUrl);

      /**
       * Whatever the measurement has managed by the deadline.
       *
       * The window is counted from when the measurement *started*, not from when
       * the transcript fetch finished, because the budget being spent is the
       * reader's patience and the two ran concurrently. Waiting the full window
       * again after a two-second fetch would make the response take four and a
       * half seconds to deliver nothing extra — measured, before this was a
       * deadline rather than a duration.
       *
       * Null covers both "it failed" and "it is still going"; the row is written
       * the same way for both.
       */
      const measured = await settled(
        measurement,
        Math.max(0, MEASURE_SETTLE_MS - (Date.now() - startedAt)),
      );

      if (outcome.status !== 'ok') {
        const detail =
          outcome.status === 'gone'
            ? 'The publisher’s transcript is no longer at that address'
            : 'Could not reach the publisher’s transcript';

        const { row } = await store(app, id, [], 'failed', detail, null, cached);
        return ok({
          transcript: row ? toWire(row) : null,
          detail: row?.detail ?? null,
        });
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
        const { row } = await store(app, id, [], 'failed', detail, null, cached);
        return ok({
          transcript: row ? toWire(row) : null,
          detail: row?.detail ?? null,
        });
      }

      /**
       * Only cues that claim a timeline get the measurement recorded. An HTML
       * transcript has no timings to be wrong, and a column saying what its
       * non-existent timings were measured against would be noise.
       */
      const { row, published } = await store(
        app,
        id,
        segments,
        'ready',
        null,
        null,
        cached,
        isTimed(segments) ? measured : null,
      );

      /**
       * Finish the measurement after the reader has gone.
       *
       * Deliberately not awaited, and deliberately guarded on `revision` in the
       * update below: by the time this resolves the row may have been replaced by
       * a generated transcript or re-derived by a newer parser, and a late write
       * must not overwrite either.
       */
      if (published && row && !measured && isTimed(segments)) {
        void measurement
          .then((late) => (late ? recordMeasurement(app, row, late) : undefined))
          .catch(() => undefined);
      }

      return ok({
        transcript: row ? toWire(row) : null,
        detail: row?.detail ?? null,
      });
    },
  );
}

/**
 * What the cues were timed against, or null if it could not be established.
 *
 * Deliberately fail-soft, and deliberately not awaited into anything that can
 * fail the request. This is a measurement that makes a *warning* possible; the
 * transcript is perfectly readable without it, and a publisher whose CDN refuses
 * ranged requests must not therefore lose their transcript. Every unhappy path
 * here — no enclosure length, variable bitrate, a CDN that will not report a
 * size, an outright network failure — returns null and is treated downstream as
 * "not measured", which is already a state the column has to represent.
 */
async function measureAudio(episode: {
  audioUrl: string;
  audioLengthBytes: number | null;
}): Promise<{ audioDurationMs: number; audioBytes: number } | null> {
  try {
    const shape = await readAudioShape(episode.audioUrl, {
      signal: AbortSignal.timeout(MEASURE_TIMEOUT_MS),
    });
    if (shape.status !== 'ok') return null;

    const inserted = insertedAudio(shape, episode.audioLengthBytes);
    if (!inserted) return null;

    return {
      // The master's length, not the served copy's — the column means "the audio
      // these cues describe", and the entire point is that the two differ.
      audioDurationMs: inserted.declaredDurationMs,
      audioBytes: episode.audioLengthBytes!,
    };
  } catch {
    return null;
  }
}

/**
 * `promise`, if it resolves within `ms`; null if it is still running.
 *
 * The promise is not cancelled — the caller still holds it and wants it to
 * finish. This only decides how long to stand there watching.
 */
async function settled<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    // Do not hold the process open for a label. `unref` is the difference
    // between a fast shutdown and one that waits out every pending timer.
    timer.unref?.();
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Write a measurement that arrived after its request had already been answered. */
async function recordMeasurement(
  app: FastifyInstance,
  observed: VersionedTranscriptRow,
  measured: { audioDurationMs: number; audioBytes: number },
): Promise<void> {
  await app.db
    .update(transcripts)
    .set(measured)
    .where(
      and(
        eq(transcripts.episodeId, observed.episodeId),
        // Only the row this measurement was taken for. A generated transcript
        // that landed in the meantime describes different audio entirely.
        eq(transcripts.source, 'feed'),
        eq(transcripts.revision, TRANSCRIPT_REVISION),
        eq(transcripts.status, 'ready'),
        sql`${transcripts.fetchedAt} = ${observed.fetchedAtVersion}::timestamptz`,
        eq(transcripts.segments, observed.segments),
      ),
    );
}

async function store(
  app: FastifyInstance,
  episodeId: string,
  segments: Transcript['segments'],
  status: 'ready' | 'failed',
  detail: string | null,
  language: string | null,
  observed: VersionedTranscriptRow | undefined,
  measured: { audioDurationMs: number; audioBytes: number } | null = null,
) {
  const values = {
    episodeId,
    source: 'feed' as const,
    status,
    detail,
    language: language ?? 'en',
    segments,
    audioDurationMs: measured?.audioDurationMs ?? null,
    audioBytes: measured?.audioBytes ?? null,
    alignment: null,
    revision: TRANSCRIPT_REVISION,
    fetchedAt: new Date(),
  };

  // Use the queue's episode -> job lock order. A publisher fetch runs outside
  // this transaction; its result cannot replace work admitted while it waited.
  return app.db.transaction(async (tx) => {
    const [episode] = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .for('update');
    if (!episode) throw notFound('Episode');
    const [job] = await tx
      .select({ episodeId: transcriptionJobs.episodeId })
      .from(transcriptionJobs)
      .where(eq(transcriptionJobs.episodeId, episodeId))
      .for('update');
    const [current] = await tx
      .select(versionedColumns)
      .from(transcripts)
      .where(eq(transcripts.episodeId, episodeId));
    if (
      job ||
      current?.source === 'generated' ||
      (current &&
        (!observed ||
          current.fetchedAtVersion !== observed.fetchedAtVersion ||
          current.source !== observed.source ||
          current.status !== observed.status ||
          current.revision !== observed.revision ||
          JSON.stringify(current.segments) !== JSON.stringify(observed.segments))) ||
      (!current && observed)
    ) {
      return { row: current ?? null, published: false };
    }
    const [row] = await tx
      .insert(transcripts)
      .values(values)
      .onConflictDoUpdate({ target: transcripts.episodeId, set: values })
      .returning(versionedColumns);
    return { row: row!, published: true };
  });
}

export function toWire(row: {
  episodeId: string;
  source: string;
  status: string;
  language: string;
  /**
   * Optional on the parameter, because two call sites hand this freshly built
   * rows from the publisher path, where nothing was measured. `?? null` below
   * keeps "we did not measure" and "we measured zero" distinct.
   */
  audioDurationMs?: number | null;
  alignment?: TranscriptAlignment | null;
  segments: Transcript['segments'];
}): Transcript {
  /**
   * Sorted on the way out as well as on the way in.
   *
   * Both writers order their segments now, but rows written before they did are
   * still in the database and cannot be fixed by changing a writer. A generated
   * transcript assembled from several chunks could carry a hallucinated tail
   * that starts after the following chunk begins, and `activeSegmentIndex` is a
   * binary search — over an unsorted array it does not fail at the bad element,
   * it returns wrong answers across a whole region of the episode.
   *
   * Copied rather than sorted in place: `row.segments` is the object the query
   * returned, and mutating it would reorder whatever else holds a reference.
   * Indices are reassigned to match, because the client uses them both as React
   * keys and to find a line in the DOM.
   */
  const ordered = [...row.segments]
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment, index) => ({ ...segment, index }));

  /**
   * Apply the correction here rather than at write time.
   *
   * `segments` in the database stays exactly as the publisher sent it, so an
   * alignment that turns out to be wrong is one column to clear rather than a
   * re-fetch, and a better one can replace it without touching the cues. The
   * cost is an O(n) walk per read over an array that was being copied and sorted
   * on this path anyway.
   *
   * Re-sorted *after* mapping as well as before. A step boundary falling inside a
   * cue stretches that cue rather than moving it, so ordering is preserved in
   * practice — but `activeSegmentIndex` is a binary search, and over an unsorted
   * array it does not fail at the bad element, it returns wrong answers across a
   * whole region of the episode. Cheap insurance against a map nobody predicted.
   */
  const aligned = row.alignment
    ? applyOffsetMap(ordered, row.alignment)
        .sort((a, b) => a.startMs - b.startMs)
        .map((segment, index) => ({ ...segment, index }))
    : ordered;

  return {
    episodeId: row.episodeId,
    source: row.source as Transcript['source'],
    status: row.status as Transcript['status'],
    language: row.language,
    timed: isTimed(aligned),
    // What the cues were timed against, so the player can notice it is playing
    // a different cut — see `Transcript.audioDurationMs`.
    audioDurationMs: row.audioDurationMs ?? null,
    aligned: Boolean(row.alignment),
    alignedAgainstDurationMs: row.alignment?.audioDurationMs ?? null,
    segments: aligned,
  };
}
