/**
 * Generating a transcript for an episode the publisher never transcribed.
 *
 * This is the load-bearing piece of the AI phase, because of a fact established
 * in Phase 9: **86% of the catalogue has no transcript at all**, and the 14%
 * that does ships untimed HTML prose. So summaries, chapters and grounded
 * answers have almost nothing to read unless we produce it — and chapters in
 * particular need timings, which no publisher transcript has.
 *
 * It writes into the same `transcripts` row the publisher's would occupy, with
 * `source: 'generated'`. An episode has one transcript; where it came from is a
 * property of that transcript, not a reason for a second table.
 *
 * **The work happens in a worker, not in the request.** Asking only writes a
 * row to the queue. This used to run inline — `void run(...)` after the response
 * had gone out — and the state that tracked it lived in module-level `Map`s,
 * which is correct exactly as long as the process survives. It routinely did
 * not: a deploy, a crash, or a free-tier instance being reaped mid-job left the
 * transcript saying `processing` with nothing working on it and no way to tell,
 * so the client polled a job that would never finish and never fail. See
 * `queue.ts` for the state that replaced those maps.
 */

import { episodes, transcripts, type Database, type StoredSegment } from '@cue/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.ts';
import { claimQuota, keyFor, refundQuota } from './access.ts';
import { fetchAudio } from './audio.ts';
import { transcribe as transcribeChunk, type TranscribedSegment } from './groq.ts';
import { chunkMp3, durationMs } from './mp3.ts';
import { complete, enqueue, fail, heartbeat, isActive, jobFor, type JobProgress } from './queue.ts';

/**
 * Upload budget per request.
 *
 * Groq's ceiling is 25MB on the free tier. 20MB leaves room for multipart
 * framing and, more usefully, for the possibility that a chunk lands slightly
 * over budget because a single frame could not be split.
 */
const CHUNK_BYTES = 20 * 1024 * 1024;

export type TranscribeProgress = JobProgress;

/** Whether an episode is queued or running, anywhere. */
export function isTranscribing(app: FastifyInstance, episodeId: string): Promise<boolean> {
  return isActive(app.db, episodeId);
}

/**
 * Ask for a transcript.
 *
 * Returns as soon as the job is *recorded*, not when it is started and
 * certainly not when it is finished — an hour of audio is several large uploads
 * and minutes of work, which no HTTP request should be held open for.
 */
export async function startTranscription(
  app: FastifyInstance,
  episodeId: string,
  userId: string,
): Promise<{ started: boolean; detail: string | null }> {
  const [episode] = await app.db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);

  if (!episode) throw new AppError('not_found', 'Episode not found');

  const [existing] = await app.db
    .select()
    .from(transcripts)
    .where(eq(transcripts.episodeId, episodeId))
    .limit(1);

  if (existing?.status === 'ready' && existing.segments.length > 0) {
    return { started: false, detail: 'This episode already has a transcript' };
  }

  // Asked twice for the same episode: join the job that exists rather than
  // starting a second one against the same audio.
  if (await isActive(app.db, episodeId)) {
    return { started: false, detail: 'Already being transcribed' };
  }

  /**
   * Charged here, before the job is visible to a worker.
   *
   * Quota belongs to the asking, not to the doing: two people requesting the
   * same episode at once must not both pass a limit of one, and someone must
   * not be able to queue a hundred episodes and be billed for the first. What
   * the job stores is the *day* it was charged to, so a worker in another
   * process can put it back if the work never happens.
   */
  const { metered, day } = await claimQuota(app, userId);

  await enqueue(app.db, { episodeId, userId, quotaDay: metered ? day : null });
  await mark(app.db, episodeId, 'processing', null);

  return { started: true, detail: null };
}

/** How far along, read from the row so any instance can answer. */
export async function transcribeProgress(
  app: FastifyInstance,
  episodeId: string,
): Promise<TranscribeProgress | null> {
  const job = await jobFor(app.db, episodeId);
  if (!job || job.status !== 'running' || !job.stage) return null;

  return {
    stage: job.stage as TranscribeProgress['stage'],
    done: job.done,
    total: job.total,
  };
}

async function mark(
  db: Database,
  episodeId: string,
  status: 'processing' | 'failed',
  detail: string | null,
): Promise<void> {
  const values = {
    episodeId,
    source: 'generated' as const,
    status,
    detail,
    language: 'en',
    segments: [] as StoredSegment[],
    fetchedAt: new Date(),
  };

  await db
    .insert(transcripts)
    .values(values)
    .onConflictDoUpdate({ target: transcripts.episodeId, set: values });
}

function detailOf(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'Transcription failed. It can be tried again.';
}

/**
 * Do one job, start to finish.
 *
 * Called by the worker loop with a job it has already claimed. Everything that
 * can fail is inside the try: the caller's contract is that this settles the
 * job either way and never throws, because a rejection escaping here would take
 * the loop — and every job behind it — down with it.
 */
export async function runJob(
  app: FastifyInstance,
  job: { episodeId: string; userId: string | null; quotaDay: string | null },
): Promise<void> {
  const { episodeId } = job;

  try {
    const [episode] = await app.db
      .select({ audioUrl: episodes.audioUrl })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1);

    if (!episode) throw new AppError('not_found', 'Episode not found');
    if (!job.userId) throw new AppError('bad_request', 'The account that asked for this is gone');

    // Resolved now rather than carried from the request: this may be a different
    // process, and a provider key is not something to store on a queue row.
    const funding = await keyFor(app, job.userId);

    await run(app, episodeId, episode.audioUrl, funding);
    await complete(app.db, episodeId);
  } catch (error) {
    const detail = detailOf(error);
    const { exhausted } = await fail(app.db, episodeId, detail);

    app.log.error({ err: error, episodeId, exhausted }, 'transcription attempt failed');

    if (exhausted) {
      // Only now is this a dead end worth showing. Marking the transcript
      // failed while a retry is still queued would report one to a reader who
      // is about to get a transcript.
      await mark(app.db, episodeId, 'failed', detail);

      // The work was charged for and will not happen. Refunded here rather than
      // per attempt, because a retry spends nothing new.
      if (job.userId && job.quotaDay) {
        await refundQuota(app, job.userId, job.quotaDay).catch(() => undefined);
      }
    }
  }
}

async function run(
  app: FastifyInstance,
  episodeId: string,
  audioUrl: string,
  funding: { key: string; byok: boolean },
): Promise<void> {
  await heartbeat(app.db, episodeId, { stage: 'fetching', done: 0, total: 0 });

  const audio = await fetchAudio(audioUrl);

  if (audio.status !== 'ok') {
    throw new AppError('upstream_unavailable', `Could not fetch the audio: ${audio.detail}`);
  }

  await heartbeat(app.db, episodeId, { stage: 'splitting', done: 0, total: 0 });

  const chunks = chunkMp3(audio.bytes, CHUNK_BYTES);

  /**
   * Not an MP3.
   *
   * A minority of shows ship AAC in an MP4 container, which cannot be split on
   * frame boundaries by this code. If it fits in one upload we send it whole
   * and Whisper handles the format perfectly well; if it does not, we say so
   * plainly rather than producing half a transcript. Splitting MP4 properly
   * means parsing sample tables, which is a different piece of work than this.
   */
  const pieces =
    chunks.length > 0
      ? chunks
      : audio.bytes.length <= CHUNK_BYTES
        ? [{ bytes: audio.bytes, startMs: 0, durationMs: 0 }]
        : [];

  if (pieces.length === 0) {
    throw new AppError(
      'bad_request',
      'This episode’s audio is in a format too large to split for transcription (only MP3 can be split).',
    );
  }

  app.log.info(
    { episodeId, chunks: pieces.length, bytes: audio.bytes.length, durationMs: durationMs(audio.bytes) },
    'transcribing',
  );

  const collected: StoredSegment[] = [];

  /**
   * One chunk at a time.
   *
   * Parallel uploads would finish sooner and would also be the fastest way to
   * hit the free tier's rate limit on the shared key, converting a slow success
   * into a fast failure for everyone.
   */
  let done = 0;
  await heartbeat(app.db, episodeId, { stage: 'transcribing', done, total: pieces.length });

  for (const piece of pieces) {
    const segments = await transcribeChunk({
      key: funding.key,
      byok: funding.byok,
      bytes: piece.bytes,
      filename: `${episodeId}-${piece.startMs}.mp3`,
    });

    done += 1;
    // Doubles as the liveness beat. A chunk is minutes of work, so a job that
    // did not report between them would look abandoned and be taken by another
    // worker halfway through.
    await heartbeat(app.db, episodeId, { stage: 'transcribing', done, total: pieces.length });

    for (const segment of shift(segments, piece.startMs)) {
      collected.push({
        index: collected.length,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        // Whisper does not diarize. A speaker field invented from turn-taking
        // would be a guess presented as a fact, so it stays null and the UI
        // simply does not offer speaker labels for generated transcripts.
        speaker: null,
      });
    }
  }

  if (collected.length === 0) {
    throw new AppError('upstream_unavailable', 'The transcription came back empty');
  }

  await heartbeat(app.db, episodeId, {
    stage: 'saving',
    done: pieces.length,
    total: pieces.length,
  });

  await app.db
    .update(transcripts)
    .set({
      status: 'ready',
      source: 'generated',
      detail: null,
      segments: collected,
      fetchedAt: new Date(),
    })
    .where(eq(transcripts.episodeId, episodeId));

  app.log.info({ episodeId, segments: collected.length }, 'transcription ready');
}

/**
 * Move a chunk's cues into episode time.
 *
 * Whisper times every upload from zero, so without this every chunk after the
 * first would claim to start at the beginning of the episode — and the
 * follow-along highlight would jump back to the top three times an hour.
 */
export function shift(segments: TranscribedSegment[], offsetMs: number): TranscribedSegment[] {
  if (offsetMs === 0) return segments;

  return segments.map((segment) => ({
    startMs: segment.startMs + offsetMs,
    // A zero end is the untimed fallback from a chunk with no segment
    // boundaries; shifting it would invent a span that was never measured.
    endMs: segment.endMs === 0 ? 0 : segment.endMs + offsetMs,
    text: segment.text,
  }));
}
