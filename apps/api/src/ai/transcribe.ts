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
 */

import { episodes, transcripts, type StoredSegment } from '@cue/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors.ts';
import { resolve } from './access.ts';
import { fetchAudio } from './audio.ts';
import { transcribe as transcribeChunk, type TranscribedSegment } from './groq.ts';
import { chunkMp3, durationMs } from './mp3.ts';

/**
 * Upload budget per request.
 *
 * Groq's ceiling is 25MB on the free tier. 20MB leaves room for multipart
 * framing and, more usefully, for the possibility that a chunk lands slightly
 * over budget because a single frame could not be split.
 */
const CHUNK_BYTES = 20 * 1024 * 1024;

/**
 * How long a `processing` row is believed before it is treated as abandoned.
 *
 * Transcription runs in this process, so a deploy or a crash mid-job leaves a
 * row claiming to be in progress with nothing working on it. Without this, that
 * episode could never be transcribed again — the guard against double-starting
 * would keep refusing forever.
 */
const STALE_PROCESSING_MS = 20 * 60 * 1000;

/** Jobs in flight in *this* process, so two requests cannot start the same one. */
const inFlight = new Set<string>();

export function isTranscribing(episodeId: string): boolean {
  return inFlight.has(episodeId);
}

/**
 * How far along a running job is.
 *
 * Deliberately in memory and not in the database, for the same reason
 * `inFlight` above is: the work happens in this process, so progress only means
 * anything while this process is doing it. A crash takes the job with it, and a
 * percentage left behind in a row would then be a number describing nothing.
 *
 * `stage` rather than a bare fraction, because the two phases fail and stall for
 * completely different reasons and a listener watching a bar sit at 4% deserves
 * to know whether we are downloading a publisher's audio or waiting on a model.
 */
export type TranscribeProgress = {
  stage: 'fetching' | 'splitting' | 'transcribing' | 'saving';
  /** Chunks finished and chunks total. Both 0 before the audio has been split. */
  done: number;
  total: number;
};

const progress = new Map<string, TranscribeProgress>();

export function transcribeProgress(episodeId: string): TranscribeProgress | null {
  return progress.get(episodeId) ?? null;
}

/**
 * Start transcribing, and return once it is under way rather than once it is
 * finished.
 *
 * An hour of audio is a couple of minutes of work — several uploads, each of
 * them tens of megabytes. Holding an HTTP request open for that would time out
 * at every proxy between here and the client. So the row moves to `processing`,
 * the caller gets that immediately, and the clients poll the transcript
 * endpoint they already use.
 */
export async function startTranscription(
  app: FastifyInstance,
  episodeId: string,
  userId: string,
): Promise<{ started: boolean; detail: string | null }> {
  const [episode] = await app.db
    .select()
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

  const stale =
    existing?.status === 'processing' &&
    Date.now() - existing.fetchedAt.getTime() > STALE_PROCESSING_MS;

  if (inFlight.has(episodeId) || (existing?.status === 'processing' && !stale)) {
    return { started: false, detail: 'Already being transcribed' };
  }

  // The quota is claimed here, before any work, so two people asking for the
  // same episode at once cannot both pass a limit of one.
  const funding = await resolve(app, userId);

  inFlight.add(episodeId);
  progress.set(episodeId, { stage: 'fetching', done: 0, total: 0 });
  await mark(app, episodeId, 'processing', null);

  /**
   * Deliberately not awaited.
   *
   * The work continues after this function returns and after the HTTP response
   * is sent. `void` with a `catch` rather than a floating promise: an
   * unhandled rejection here would take down the process, and the failure it
   * would take it down for is a publisher's dead audio URL.
   */
  void run(app, episodeId, episode.audioUrl, funding)
    .then(() => funding.settle('ok'))
    .catch(async (error: unknown) => {
      app.log.error({ err: error, episodeId }, 'transcription failed');
      await funding.settle('failed');
      await mark(app, episodeId, 'failed', detailOf(error));
    })
    .finally(() => {
      inFlight.delete(episodeId);
      progress.delete(episodeId);
    });

  return { started: true, detail: null };
}

function detailOf(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return 'Transcription failed. It can be tried again.';
}

async function mark(
  app: FastifyInstance,
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

  await app.db
    .insert(transcripts)
    .values(values)
    .onConflictDoUpdate({ target: transcripts.episodeId, set: values });
}

async function run(
  app: FastifyInstance,
  episodeId: string,
  audioUrl: string,
  funding: { key: string; byok: boolean },
): Promise<void> {
  const audio = await fetchAudio(audioUrl);

  if (audio.status !== 'ok') {
    throw new AppError('upstream_unavailable', `Could not fetch the audio: ${audio.detail}`);
  }

  progress.set(episodeId, { stage: 'splitting', done: 0, total: 0 });

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
  progress.set(episodeId, { stage: 'transcribing', done, total: pieces.length });

  for (const piece of pieces) {
    const segments = await transcribeChunk({
      key: funding.key,
      byok: funding.byok,
      bytes: piece.bytes,
      filename: `${episodeId}-${piece.startMs}.mp3`,
    });

    done += 1;
    progress.set(episodeId, { stage: 'transcribing', done, total: pieces.length });

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

  progress.set(episodeId, { stage: 'saving', done: pieces.length, total: pieces.length });

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
