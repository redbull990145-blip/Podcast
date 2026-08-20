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

  /**
   * What this particular copy of the audio actually was.
   *
   * Measured by walking frame headers, so it describes the bytes in hand rather
   * than anything the publisher claimed. Kept in a variable and *stored* with
   * the transcript, because the enclosure is stitched per request: the file a
   * listener is served is routinely a different length from this one, and the
   * cues below are only valid against this one. See `transcripts.audioDurationMs`.
   */
  const audioDurationMs = durationMs(audio.bytes);
  const audioBytes = audio.bytes.length;

  app.log.info(
    { episodeId, chunks: pieces.length, bytes: audioBytes, durationMs: audioDurationMs },
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

    for (const segment of placeChunk(segments, piece)) {
      collected.push({
        index: collected.length,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        // Whisper does not diarize. A speaker field invented from turn-taking
        // would be a guess presented as a fact, so it stays null and the UI
        // simply does not offer speaker labels for generated transcripts.
        speaker: null,
        words: segment.words,
      });
    }
  }

  if (collected.length === 0) {
    throw new AppError('upstream_unavailable', 'The transcription came back empty');
  }

  /**
   * Sorted before it is stored, exactly as the publisher path does.
   *
   * `parseTranscript` has sorted defensively from the start, and its comment
   * gives the reason: "a concatenated or re-timed transcript can arrive out of
   * order, and every consumer downstream assumes ascending starts." This *is*
   * the concatenated case — it is assembled here, from separate uploads — and
   * it was the one path that skipped the sort.
   *
   * `placeChunk` now keeps each chunk inside its own span, so this should be a
   * no-op. It stays because the cost is one sort of an already-ordered array
   * per episode, and the thing it protects against is a binary search silently
   * returning wrong answers across a whole region of the transcript.
   *
   * Indices are assigned after sorting: they are positions, and the client uses
   * them as React keys and for `data-line` lookups.
   */
  collected.sort((a, b) => a.startMs - b.startMs);
  collected.forEach((segment, index) => {
    segment.index = index;
  });

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
      // Recorded with the cues they describe, in the same write, so a transcript
      // can never exist without the measurement that says what it is timed
      // against.
      audioDurationMs,
      audioBytes,
      fetchedAt: new Date(),
    })
    .where(eq(transcripts.episodeId, episodeId));

  app.log.info(
    { episodeId, segments: collected.length, audioDurationMs, audioBytes },
    'transcription ready',
  );
}

/**
 * Move a chunk's cues into episode time, and hold them inside it.
 *
 * Whisper times every upload from zero, so without this every chunk after the
 * first would claim to start at the beginning of the episode — and the
 * follow-along highlight would jump back to the top three times an hour.
 */
/**
 * A cue may not leave the audio it was transcribed from.
 *
 * Whisper's timings are inferred rather than measured, and its documented
 * failure mode on trailing silence or music is to run the last cue of a chunk
 * well past the end of that chunk — sometimes by tens of seconds. Left alone,
 * such a cue starts *after* the first cue of the following chunk, and the
 * concatenated array is no longer sorted by `startMs`.
 *
 * That is worse than it sounds. `activeSegmentIndex` is a binary search, and a
 * binary search over unsorted data does not fail politely at the bad element —
 * it can return the wrong answer for a whole region of the episode. The visible
 * result is the highlight sitting on the wrong line minutes away from the
 * actual fault, which is exactly the shape of an intermittent, hard-to-describe
 * desync report.
 *
 * `durationMs` is 0 for the single-piece fallback path, where the audio was not
 * MP3 and never went through frame-walking. Zero means "not measured", so it
 * clamps nothing rather than clamping everything to the start of the episode.
 */
export function placeChunk(
  segments: TranscribedSegment[],
  chunk: { startMs: number; durationMs: number },
): TranscribedSegment[] {
  const known = chunk.durationMs > 0;
  const chunkEndMs = chunk.startMs + chunk.durationMs;

  /**
   * The untimed fallback: one cue, no boundaries, both times zero.
   *
   * Produced by `transcribeChunk` when a response carries only flat text. It
   * used to be shifted by its start alone and left with `endMs: 0`, which on
   * any chunk but the first produced a cue ending forty minutes before it
   * began. Everything downstream treats that as corrupt — `segmentWords` finds
   * a non-positive span and sweeps nothing, and `gapBefore` reads the zero as
   * the previous cue's end and reports a silence stretching back to the start
   * of the episode, which the player draws as a row of waiting dots over the
   * whole transcript.
   *
   * The honest reading is that the text was spoken *somewhere in this chunk*,
   * so it is given the chunk. That is a real span, not an invented one.
   */
  if (segments.length === 1 && segments[0]!.startMs === 0 && segments[0]!.endMs === 0) {
    return [
      {
        startMs: chunk.startMs,
        endMs: known ? chunkEndMs : chunk.startMs,
        text: segments[0]!.text,
        // An untimed cue cannot have timed words. Whatever came back describes
        // a timeline this segment does not have.
        words: null,
      },
    ];
  }

  const placed: TranscribedSegment[] = [];

  for (const segment of segments) {
    const startMs = segment.startMs + chunk.startMs;

    // Past the end of its own chunk entirely. The following chunk covers this
    // audio and transcribed it properly, so this is a hallucinated tail.
    if (known && startMs >= chunkEndMs) continue;

    /**
     * A cue whose end Whisper omitted comes back as 0, which is before its own
     * start. Give it the rest of the chunk rather than a negative span.
     *
     * Where the chunk's length was never measured — the single-piece fallback
     * for audio that is not MP3 — there is no "rest of the chunk" to give, and
     * `chunkEndMs` is just the chunk's own start. Falling back to that produced
     * an end before the start and the cue was dropped, silently punching a hole
     * in the transcript of every AAC episode. The cue's own start is the honest
     * answer there: a zero-length span, which downstream already understands.
     */
    const openEnd = known ? chunkEndMs : startMs;
    const rawEnd = segment.endMs > segment.startMs ? segment.endMs + chunk.startMs : openEnd;
    const endMs = known ? Math.min(rawEnd, chunkEndMs) : rawEnd;

    if (endMs < startMs) continue;

    /**
     * Words are shifted, and otherwise left exactly as they were measured.
     *
     * They are timed from the same zero as the segment, so they need the same
     * offset. They are deliberately *not* clamped to the cue, and not filtered.
     *
     * Clamping them was a real bug and an instructive one. The cue above may
     * have just been trimmed to the end of the chunk; folding a word into that
     * trimmed span collapsed both of its ends onto the same millisecond, and
     * the span filter that followed then deleted it outright — so the clamp
     * fired precisely when it was needed and destroyed the last word or two of
     * the final cue in every chunk.
     *
     * It also broke the invariant `partitionWords` exists to establish: these
     * words must still spell `segment.text`, because the player renders the
     * *active* line from them and every other line from the text. A deleted
     * word makes the line lose a word at the instant the highlight reaches it.
     *
     * A word running a little past its cue costs nothing — the sweep is driven
     * by each word's own span, and the cue's end is only used for ordering.
     */
    const words =
      segment.words?.map((word) => ({
        startMs: word.startMs + chunk.startMs,
        endMs: word.endMs + chunk.startMs,
        text: word.text,
      })) ?? null;

    placed.push({ startMs, endMs, text: segment.text, words: words?.length ? words : null });
  }

  return placed;
}
