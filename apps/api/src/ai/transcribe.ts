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
import { streamAudioChunks } from './audio.ts';
import { transcribe as transcribeChunk, type TranscribedSegment } from './groq.ts';
import type { Mp3Chunk } from './mp3.ts';
import { complete, enqueue, fail, heartbeat, isActive, jobFor, type JobProgress } from './queue.ts';

/**
 * Upload budget per request.
 *
 * Groq's ceiling is 25MB on the free tier. 20MB leaves room for multipart
 * framing and, more usefully, for the possibility that a chunk lands slightly
 * over budget because a single frame could not be split.
 */
const CHUNK_BYTES = 20 * 1024 * 1024;

/**
 * How long one episode may spend waiting out the provider's rate limit, in
 * total, across all of its chunks.
 *
 * A job-wide budget rather than a per-upload one. The free tier's allowance
 * refills continuously, so a long episode does not fail against it so much as
 * meter itself through it — the useful question is not "is this chunk worth
 * waiting for" but "is this episode going to finish today". Forty-five minutes
 * covers a full refill cycle with room to spare, which is what a two-and-a-half
 * hour episode needs on a shared key; past that the shared allowance is not
 * going to serve this episode today, and saying so returns the reader's button
 * rather than holding the worker indefinitely.
 */
const WAIT_BUDGET_MS = 45 * 60_000;

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
    // Only meaningful while waiting, and only while still in the future — a
    // deadline that has passed says the wait is over, which is not something
    // to ask the client to render a countdown to.
    ...(job.waitingUntil && job.waitingUntil.getTime() > Date.now()
      ? { waitingUntilMs: job.waitingUntil.getTime() }
      : {}),
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

    /*
      Some failures are answers, not accidents.

      A missing episode, a deleted account, an enclosure that is too long or is
      not audio: none of those change between attempt one and attempt three, so
      spending two more attempts on them costs the listener several minutes of
      "Writing captions…" and this server up to another 240MB of download to
      reach a conclusion it already had. Terminal on the first failure instead —
      the message is the same one it would have shown eventually, several
      minutes earlier.
    */
    const terminal = isPermanent(error);

    app.log.error(
      { err: error, episodeId, exhausted, terminal },
      'transcription attempt failed',
    );

    /*
      Marked failed here unconditionally now — not only once `exhausted` or
      `terminal`, which is the fix for the report this file exists to answer.

      The comment this replaces reasoned that marking the transcript failed
      "while a retry is still queued" would lie to a reader about to get one.
      That retry does not exist. `fail()` in `queue.ts` always leaves the job
      unreachable to `claimNext` — nothing distinguishes "one attempt left" from
      "out of attempts" in what it claims — so the only way back from *any*
      clean failure is a person pressing "Generate captions" again, which
      `enqueue()` answers by reviving the job. `exhausted` also cannot become
      true through that path: reviving resets `attempts` to zero, so a single
      button press can never accumulate the count `MAX_ATTEMPTS` compares
      against, and this branch was reached almost only by errors this codebase
      already treats as terminal — the case it was supposedly distinguishing
      from barely occurs.

      So leaving the transcript at `processing` here left it there forever: no
      further write was ever coming, the progress bar had nothing left to move
      it, and the reader had no way to learn why or a button to press again —
      `GenerateCaptions` only shows one once the status is no longer
      `processing`. This is not the rare case; for an ordinary rate limit or a
      dropped connection, it was the *only* case.
    */
    await mark(app.db, episodeId, 'failed', detail);

    if (exhausted || terminal) {
      // The work was charged for and will not happen. Refunded here rather than
      // per attempt, because a retry spends nothing new.
      if (job.userId && job.quotaDay) {
        await refundQuota(app, job.userId, job.quotaDay).catch(() => undefined);
      }
    }
  }
}

/**
 * Whether this error will still be true on the next attempt.
 *
 * Reads the code rather than the message: the strings are written for people
 * and change freely, and matching on them is how a retry policy silently stops
 * working the day somebody improves the wording.
 */
function isPermanent(error: unknown): boolean {
  return (
    error instanceof AppError &&
    (error.code === 'bad_request' || error.code === 'not_found')
  );
}

async function run(
  app: FastifyInstance,
  episodeId: string,
  audioUrl: string,
  funding: { key: string; byok: boolean },
): Promise<void> {
  await heartbeat(app.db, episodeId, { stage: 'fetching', done: 0, total: 0 });

  const collected: StoredSegment[] = [];
  let uploaded = 0;

  /**
   * How many chunks this episode probably has, from its declared size — set
   * once the download's response headers arrive, long before the first chunk
   * does. `0` means unknown, matching every other "nothing to count yet" spot
   * in this progress model.
   *
   * The gap this closes: for a large episode the download is the single
   * longest silent stretch in the whole job — a 350MB, 320kbps show takes over
   * a minute just to fetch, and until now nothing was reported for the whole
   * of it beyond the one "fetching" heartbeat sent before the request even
   * went out. A listener watching that has no way to tell a slow download from
   * a dead one. This does not turn the fetching stage determinate — there is
   * still nothing *done* to show a fraction of — but it lets the label say
   * something true about how long a wait to expect, rather than nothing.
   */
  let estimatedChunks = 0;

  /** Time already spent parked on rate limits, against `WAIT_BUDGET_MS`. */
  let waitedMs = 0;

  /*
    Upload sequentially as chunks arrive from the download, rather than
    downloading everything first and then uploading.

    This is what lets a three-hour, 320kbps episode — 350MB, a real file in
    this catalogue — transcribe at all: buffering it whole before splitting is
    what the old `MAX_BYTES` ceiling existed to protect against, and it refused
    exactly this kind of long, well-recorded interview show. `streamAudioChunks`
    never holds more than roughly one chunk in memory, so the ceiling on an
    episode's length is now a sanity check rather than a memory budget — see
    the note on `MAX_BYTES` in `audio.ts`.

    Sequential rather than parallel for the same reason it always was:
    parallel uploads would finish sooner and would also be the fastest way to
    hit the free tier's rate limit on the shared key, converting a slow
    success into a fast failure for everyone.
  */
  const uploadChunk = async (piece: Mp3Chunk): Promise<void> => {
    const segments = await transcribeChunk({
      key: funding.key,
      byok: funding.byok,
      bytes: piece.bytes,
      filename: `${episodeId}-${piece.startMs}.mp3`,
      /**
       * Keep beating, and say why nothing is moving.
       *
       * Two things depend on this. The queue calls a job abandoned after three
       * minutes of silence, and a rate-limit wait can approach that on its own
       * — so without a beat here another worker would claim the episode and
       * start it again from the beginning, which is the exact duplicated
       * 350MB download this whole path exists to avoid.
       *
       * And the reader gets the truth. "Waiting for the shared allowance,
       * resuming in 1:14, 7 of 18 done" is a different message from a spinner
       * that has not moved in ten minutes, even though the spinner was the
       * honest rendering of everything this job previously knew how to say.
       * `done`/`total` stay on the real chunk count throughout, so the bar
       * holds its position rather than resetting for the pause.
       */
      onWait: ({ waitMs, remainingMs }) => {
        // The opening notice of a wait is the one that reports its full length,
        // so it is the one that charges the budget. Later notices of the same
        // wait are the countdown, and charging those would bill it repeatedly.
        if (remainingMs === waitMs) waitedMs += waitMs;

        return heartbeat(app.db, episodeId, {
          stage: 'waiting',
          done: uploaded,
          total: Math.max(estimatedChunks, uploaded),
          waitingUntilMs: Date.now() + remainingMs,
        });
      },
      rateLimitBudgetMs: Math.max(0, WAIT_BUDGET_MS - waitedMs),
    });

    uploaded += 1;
    /*
      Doubles as the liveness beat. A chunk is minutes of work, so a job that
      did not report between them would look abandoned and be taken by another
      worker halfway through.

      `total` is an estimate now rather than an exact count: the old code knew
      how many pieces existed before uploading any of them, because it had
      already downloaded and split the whole file first. Streaming trades that
      certainty for the memory saving above, so the bar is honest about it —
      `total` only ever grows to match `uploaded` if nothing better is known,
      which is the same "nothing to count yet, so do not pretend otherwise"
      reasoning the client already applies when `progress` is null.

      `estimatedChunks` is taken over the moment reality exceeds it — a size
      declared from a stitched-per-request enclosure is a guess, and `uploaded`
      is a fact.
    */
    await heartbeat(app.db, episodeId, {
      stage: 'transcribing',
      done: uploaded,
      total: Math.max(estimatedChunks, uploaded),
    });

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
  };

  const outcome = await streamAudioChunks(audioUrl, CHUNK_BYTES, uploadChunk, {
    onStarted: (declaredBytes) => {
      if (declaredBytes === null) return;
      estimatedChunks = Math.max(1, Math.ceil(declaredBytes / CHUNK_BYTES));
      // Fire-and-forget: this is a courtesy update between two real stages,
      // not a step anything downstream waits on, and the next real heartbeat
      // is at most a few seconds behind it either way.
      void heartbeat(app.db, episodeId, { stage: 'fetching', done: 0, total: estimatedChunks });
    },
  });

  if (outcome.status === 'error') {
    /*
      Two codes for one situation, because they mean different things to the
      queue. `bad_request` is this file will never work — too big, empty, gone
      — and is terminal; `upstream_unavailable` is it did not work *this time*
      and earns the retries.
    */
    throw new AppError(
      outcome.permanent ? 'bad_request' : 'upstream_unavailable',
      `Could not fetch the audio: ${outcome.detail}`,
    );
  }

  /**
   * Not an MP3, and too big to hand over whole.
   *
   * A minority of shows ship AAC in an MP4 container, which cannot be split on
   * frame boundaries by this code. If it fits in one upload it was already
   * sent whole by `streamAudioChunks` — this branch is only reached when it
   * did not, and there is nothing to do but say so plainly rather than produce
   * half a transcript. Splitting MP4 properly means parsing sample tables,
   * which is a different piece of work than this.
   */
  if (outcome.status === 'unsplittable') {
    throw new AppError(
      'bad_request',
      'This episode’s audio is in a format too large to split for transcription (only MP3 can be split).',
    );
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
   * `placeChunk` keeps each chunk inside its own span, so this should be a
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

  await heartbeat(app.db, episodeId, { stage: 'saving', done: uploaded, total: uploaded });

  await app.db
    .update(transcripts)
    .set({
      status: 'ready',
      source: 'generated',
      detail: null,
      segments: collected,
      // Recorded with the cues they describe, in the same write, so a transcript
      // can never exist without the measurement that says what it is timed
      // against. Measured by the streaming download itself now rather than by
      // walking a finished buffer, but it is the same number either way — the
      // total of every confirmed frame's duration.
      audioDurationMs: outcome.audioDurationMs,
      audioBytes: outcome.audioBytes,
      fetchedAt: new Date(),
    })
    .where(eq(transcripts.episodeId, episodeId));

  app.log.info(
    {
      episodeId,
      chunks: uploaded,
      segments: collected.length,
      audioDurationMs: outcome.audioDurationMs,
      audioBytes: outcome.audioBytes,
    },
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
