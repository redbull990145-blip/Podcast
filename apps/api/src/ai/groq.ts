/**
 * Groq, spoken to directly over its OpenAI-compatible HTTP API.
 *
 * No SDK: the surface used here is three endpoints and two response shapes, and
 * a vendor SDK would bring its own fetch, its own retry policy and its own
 * opinions about streaming to replace forty lines that do exactly what this
 * server needs. `fetch`, `FormData` and `ReadableStream` are all in the runtime
 * already.
 *
 * Every call takes an explicit key rather than reading configuration, because
 * the whole point of BYOK is that *whose* key this is changes per request. A
 * module-level client would make using the operator's key the path of least
 * resistance, which is the one mistake here that costs real money.
 */

import { AppError } from '../errors.ts';
import { delay, fetchWithDeadline, operationDeadline, withDeadline } from './deadline.ts';

const BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Whisper large v3 turbo: multilingual, and roughly three times cheaper than
 * plain v3 for accuracy differences that do not survive a podcast's background
 * music and crosstalk.
 */
export const TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';

/**
 * Llama 3.3 70B for everything textual.
 *
 * 131k of context is the deciding property: an hour of speech is roughly 12k
 * tokens, so a whole episode fits in one prompt and every answer is grounded in
 * the complete transcript. That removes the need for retrieval entirely — and
 * chunk-and-retrieve over a single document is exactly where summarisers start
 * confidently describing a segment they never read.
 */
export const CHAT_MODEL = 'llama-3.3-70b-versatile';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/**
 * Retrying the failures that are worth retrying.
 *
 * A 502 from Groq is not a statement about the request — it is a gateway in
 * front of the model having a bad second, and the same bytes sent again a moment
 * later usually work. Without this, one such blip killed an entire transcription:
 * an hour-long episode is several sequential uploads, each of them tens of
 * megabytes, and a failure on the last chunk threw away every chunk before it
 * *and* spent the user's daily allowance to produce nothing. That is the shape
 * of the bug, and it gets more likely the longer the episode — so it was worst
 * exactly where the feature is most useful.
 *
 * Only transient classes are retried here. A 401 is a wrong key and will be
 * wrong again; a 413 is audio that is genuinely too big. Those surface at once,
 * with the message that tells the user what to do.
 *
 * A 429 is neither, and is handled separately below.
 */
const RETRY_STATUS = new Set([408, 500, 502, 503, 504, 522, 524]);
const MAX_ATTEMPTS = 3;

/**
 * Waiting out a rate limit, rather than treating it as a failure.
 *
 * This is the fix for the report that a long episode could never be captioned
 * on the shared key, no matter how many times the button was pressed.
 *
 * The reasoning it replaces was half right: retrying a 429 *immediately* is
 * indeed the least helpful possible response. The conclusion drawn from that —
 * give up at once — was wrong, because a 429 from Groq arrives with a
 * `retry-after` header saying exactly when capacity will exist. That is not a
 * failure, it is an appointment, and the only thing to do with it is keep it.
 *
 * What giving up cost: a transcription is a sequence of 20MB uploads, and the
 * limit is usually reached somewhere in the middle of one. Throwing at that
 * point discarded every chunk already transcribed, so the next attempt began
 * again from a fresh 350MB download and hit the same wall at the same place.
 * The failure was therefore perfectly reproducible and the retry button could
 * not fix it — for an episode longer than the free tier's hourly audio
 * allowance, no number of attempts would ever have finished, because finishing
 * requires waiting and nothing here ever waited.
 *
 * Bounded on both axes, because "wait as long as it says" is how a worker slot
 * disappears for an afternoon. A single wait longer than `MAX_WAIT_MS` is
 * reported instead of served — at that point the honest thing is to hand the
 * reader their button back — and `DEFAULT_BUDGET_MS` caps the total across one
 * call, which the transcription path raises for itself.
 *
 * Ten minutes for a single wait, measured rather than guessed: a saturated
 * shared key answers with four-minute intervals as a matter of routine, and the
 * first version of this capped a single wait at two and a half. That looked
 * principled and simply reintroduced the bug at a higher threshold — the job
 * got six chunks in, was asked to wait 241 seconds, refused, and threw away all
 * six. The cap has to sit above what the provider actually asks for or it is
 * just the old give-up behaviour with extra steps.
 */
const MAX_WAIT_MS = 10 * 60_000;
const DEFAULT_BUDGET_MS = 60_000;

/**
 * How long to wait when a 429 arrives with no `retry-after` to read.
 *
 * Groq sends the header reliably, so this is the defensive branch rather than
 * the expected one. It exists because the alternative — falling back to the old
 * give-up behaviour — reintroduces exactly the bug above through a side door,
 * for the sake of a header being missing.
 */
const BLIND_WAIT_MS = 15_000;

/**
 * How often the caller hears from a wait in progress.
 *
 * Two jobs at once: a wait can outlast the queue's staleness window, so the
 * worker has to keep beating through one or another worker will decide it died
 * and start the whole episode again. And a reader watching a spinner deserves
 * to be told the difference between "working" and "parked until 14:32".
 */
const NOTICE_EVERY_MS = 15_000;

/** Where a wait is up to, reported every `NOTICE_EVERY_MS` while it runs. */
export type WaitNotice = {
  /** The full length of this wait, as Groq asked for it. */
  waitMs: number;
  /** How much of it is left. Counts down; reaches roughly zero. */
  remainingMs: number;
};

export type RetryOptions = {
  /** Called periodically while parked on a rate limit. See `WaitNotice`. */
  onWait?: (notice: WaitNotice) => void | Promise<void>;
  /** Total time this call may spend waiting out 429s. */
  rateLimitBudgetMs?: number;
};

/** Backoff before attempt n (1-indexed): 1s, then 3s. Jittered. */
function backoffMs(attempt: number): number {
  return attempt * 1000 * (1 + Math.random() * 0.5) + (attempt - 1) * 1000;
}

const CHAT_DEADLINE_MS = 90_000;
const TRANSCRIBE_DEADLINE_MS = 180_000;
export const CHAT_OPERATION_MS = 6 * 60_000;
export const TRANSCRIBE_OPERATION_BASE_MS = 10 * 60_000;

/**
 * `retry-after` in milliseconds, or null if it does not carry a usable number.
 *
 * The header is also allowed to be an HTTP date. Groq sends seconds, and a date
 * would need clock-skew handling to be trusted, so an unparseable value reads as
 * absent and takes the blind wait rather than a wrong one.
 */
function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  return Math.ceil(seconds * 1000);
}

/** Sleep, telling the caller where we are often enough to prove we are alive. */
async function waitOut(
  waitMs: number,
  onWait: RetryOptions['onWait'],
  signal?: AbortSignal,
): Promise<void> {
  const until = waitMs;
  let elapsed = 0;

  while (elapsed < until) {
    await onWait?.({ waitMs, remainingMs: until - elapsed });
    const slice = Math.min(NOTICE_EVERY_MS, until - elapsed);
    await delay(slice, signal);
    elapsed += slice;
  }
}

/** Exported for its tests; every caller in this module goes through it. */
export async function withRetry(
  send: () => Promise<Response>,
  signal?: AbortSignal | undefined,
  options?: RetryOptions | undefined,
): Promise<Response> {
  const budgetMs = options?.rateLimitBudgetMs ?? DEFAULT_BUDGET_MS;

  /**
   * Counts transient failures only — a rate limit does not spend one.
   *
   * They are different kinds of event and conflating them is what made the
   * attempt ceiling meaningless for the case that needed it: three 429s in a
   * row is one server saying "not yet" three times, and answering it by
   * refusing to ask again is how a long episode never finished.
   */
  let attempts = 0;
  let waitedMs = 0;

  for (;;) {
    signal?.throwIfAborted();
    let response: Response;

    try {
      response = await send();
    } catch (error) {
      // A dropped socket mid-upload is the same class of problem as a 502, and
      // on a 20MB request body it is not rare. An abort is not: that is the
      // caller having gone away, and retrying would ignore them.
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) throw error;
      await delay(backoffMs(attempts), signal);
      continue;
    }

    if (response.ok) return response;

    if (response.status === 429) {
      const asked = retryAfterMs(response) ?? BLIND_WAIT_MS;

      // Longer than we are willing to hold the job, or more than this call has
      // left to spend. Either way the answer is the same: surface it, so the
      // reader gets a message and a button rather than an unbounded spinner.
      if (asked > MAX_WAIT_MS || waitedMs + asked > budgetMs) return response;

      await response.body?.cancel();
      waitedMs += asked;
      await waitOut(asked, options?.onWait, signal);
      continue;
    }

    if (!RETRY_STATUS.has(response.status)) return response;

    attempts += 1;
    // The body has to be drained or the connection is held open for the life of
    // the process — and on the final attempt the caller reads it for the error
    // message, so only discard it when we are going round again.
    if (attempts >= MAX_ATTEMPTS) return response;
    await response.body?.cancel();
    await delay(backoffMs(attempts), signal);
  }
}

/**
 * Turn a provider failure into something the client can act on.
 *
 * A user's own invalid key must not read as "our server is broken" — it is
 * their key, they can fix it, and the message says so. A 429 against the
 * operator key means the shared free tier is saturated, which is a genuinely
 * different situation from that user's own daily quota being spent.
 */
async function failure(response: Response, byok: boolean): Promise<AppError> {
  const body = await response.text().catch(() => '');
  const detail = extractMessage(body);

  if (response.status === 401 || response.status === 403) {
    return new AppError(
      'bad_request',
      byok
        ? 'That API key was rejected by Groq. Check it in Settings.'
        : 'The service’s AI key was rejected. This is on us, not you.',
    );
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    return new AppError(
      'rate_limited',
      byok
        ? 'Groq is rate-limiting your key. Try again shortly.'
        : 'The shared AI allowance is busy right now. Add your own key in Settings to skip the queue.',
      Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSec: Math.ceil(retryAfter) } : {},
    );
  }

  if (response.status === 413) {
    return new AppError('bad_request', 'That audio was too large for the transcription service.');
  }

  return new AppError(
    'upstream_unavailable',
    detail ? `Groq: ${detail}` : `Groq returned ${response.status}`,
  );
}

/** Groq nests its message at `error.message`; fall back to the raw body. */
function extractMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const message = (parsed as { error?: { message?: unknown } }).error?.message;
    return typeof message === 'string' ? message.slice(0, 200) : null;
  } catch {
    return body.slice(0, 200) || null;
  }
}

// ------------------------------------------------------------------ chat --

export type ChatOptions = {
  key: string;
  byok: boolean;
  messages: ChatMessage[];
  /** Low by default: these are extraction tasks, not creative writing. */
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object back, for the structured generations. */
  json?: boolean;
  signal?: AbortSignal;
};

export async function chat(options: ChatOptions): Promise<string> {
  return withDeadline(
    (signal) => chatRequest({ ...options, signal }),
    options.signal,
    CHAT_OPERATION_MS,
  );
}

async function chatRequest(options: ChatOptions): Promise<string> {
  const response = await withRetry(
    () =>
      fetchWithDeadline(
        `${BASE_URL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: CHAT_MODEL,
            messages: options.messages,
            temperature: options.temperature ?? 0.2,
            max_tokens: options.maxTokens ?? 2048,
            ...(options.json ? { response_format: { type: 'json_object' } } : {}),
          }),
          ...(options.signal ? { signal: options.signal } : {}),
        },
        CHAT_DEADLINE_MS,
      ),
    options.signal,
  );

  if (!response.ok) throw await failure(response, options.byok);

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AppError('upstream_unavailable', 'The model returned an empty answer');
  }

  return content;
}

/**
 * The same call, delivered token by token.
 *
 * An answer to "what did they say about X" takes several seconds to write in
 * full and about three hundred milliseconds to *start*. Streaming is the
 * difference between those two numbers being what the reader experiences.
 */
export async function* chatStream(options: ChatOptions): AsyncGenerator<string> {
  const deadline = operationDeadline(options.signal, CHAT_OPERATION_MS);
  try {
    yield* chatStreamRequest({ ...options, signal: deadline.signal });
  } finally {
    deadline.dispose();
  }
}

async function* chatStreamRequest(options: ChatOptions): AsyncGenerator<string> {
  const response = await fetchWithDeadline(
    `${BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 1024,
        stream: true,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    },
    CHAT_DEADLINE_MS,
  );

  if (!response.ok) throw await failure(response, options.byok);
  if (!response.body) throw new AppError('upstream_unavailable', 'Groq returned no stream');

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const piece of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(piece, { stream: true });

    // SSE frames are separated by a blank line. A chunk boundary can land
    // anywhere, including mid-token, so only whole frames are consumed and the
    // remainder stays buffered.
    let split = buffer.indexOf('\n\n');

    while (split !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf('\n\n');

      const data = frame.startsWith('data:') ? frame.slice(5).trim() : null;
      if (!data || data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        // A frame that is not JSON is a keep-alive or a provider comment.
        // Dropping it is correct; failing the stream over it is not.
      }
    }
  }
}

// --------------------------------------------------------- transcription --

/** One word, timed. Whisper measures these; we no longer have to guess them. */
export type TranscribedWord = { startMs: number; endMs: number; text: string };

export type TranscribedSegment = {
  startMs: number;
  endMs: number;
  text: string;
  /**
   * The segment's words, when the model returned them.
   *
   * Null rather than empty for "not available", so a caller can tell a chunk
   * that came back without word timings from a cue that genuinely holds no
   * words. The first must fall back to estimating; the second must not.
   */
  words: TranscribedWord[] | null;
};

/**
 * Transcribe one piece of audio.
 *
 * `verbose_json`, because timings are the entire reason to generate a
 * transcript here rather than read the publisher's — a flat wall of text is
 * what they already ship, and it cannot drive follow-along or chapters.
 *
 * **Both granularities are requested.** Segments carry the paragraphing that
 * makes a transcript readable and are what the chapter and Q&A prompts consume;
 * words carry the timing that makes the highlight land on the syllable being
 * spoken. Asking for words alone would return, in Groq's own words, "only word,
 * start, and end timestamps" — losing the structure — so we ask for both and
 * keep each for what it is good at.
 *
 * Groq documents that word timestamps cost extra latency where segment
 * timestamps cost none. That is a one-time generation cost against a job
 * already measured in minutes, paid once per episode, to remove an estimation
 * layer whose error ran to hundreds of milliseconds inside a cue.
 */
export async function transcribe(
  options: Parameters<typeof transcribeRequest>[0],
): Promise<TranscribedSegment[]> {
  return withDeadline(
    (signal) => transcribeRequest({ ...options, signal }),
    options.signal,
    TRANSCRIBE_OPERATION_BASE_MS + (options.rateLimitBudgetMs ?? DEFAULT_BUDGET_MS),
  );
}

async function transcribeRequest(options: {
  key: string;
  byok: boolean;
  bytes: Uint8Array;
  filename: string;
  /** BCP-47 hint. Omitted lets Whisper detect, which is better than guessing wrong. */
  language?: string | null;
  signal?: AbortSignal;
  /**
   * Told when this upload is parked behind the provider's rate limit.
   *
   * A transcription is the one caller that genuinely should sit out a 429: it
   * is already minutes long, it has expensive finished work behind it that
   * failing would discard, and on the shared key a long episode reaches the
   * hourly allowance as a matter of course rather than as an incident. The
   * budget is raised to match — see the note on `MAX_WAIT_MS`.
   */
  onWait?: (notice: WaitNotice) => void | Promise<void>;
  /**
   * How long this upload may spend parked, of the episode's shared allowance.
   *
   * Passed in rather than fixed here because the budget that matters is the
   * *job's*, not the chunk's. A per-chunk allowance multiplies by the number of
   * chunks — eighteen of them at ten minutes each is a worker gone for three
   * hours — while the question worth bounding is how long this episode may take
   * in total. The caller subtracts what it has already spent, so a job that has
   * been waiting all along tightens its own budget as it goes.
   */
  rateLimitBudgetMs?: number;
}): Promise<TranscribedSegment[]> {
  // Copied into a fresh ArrayBuffer: chunks are subarrays of one large episode
  // buffer, and `new Blob([subarray])` would otherwise be free to reference the
  // whole backing store and upload far more than the slice.
  const copy = new Uint8Array(options.bytes.length);
  copy.set(options.bytes);
  const blob = new Blob([copy], { type: 'audio/mpeg' });

  /**
   * A fresh `FormData` per attempt.
   *
   * The body of a `fetch` is a stream and a stream can only be read once, so
   * reusing one across a retry sends an empty body — which fails in a way that
   * looks nothing like the transient error that caused the retry. Rebuilding it
   * is cheap: the `Blob` underneath is shared, so nothing is copied again.
   */
  const response = await withRetry(
    () => {
      const form = new FormData();
      form.append('file', blob, options.filename);
      form.append('model', TRANSCRIBE_MODEL);
      form.append('response_format', 'verbose_json');
      // Repeated, not comma-joined: this is multipart form data, and the bracket
      // suffix is part of the literal field name Groq documents.
      form.append('timestamp_granularities[]', 'segment');
      form.append('timestamp_granularities[]', 'word');
      if (options.language) form.append('language', options.language);

      return fetchWithDeadline(
        `${BASE_URL}/audio/transcriptions`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${options.key}` },
          body: form,
          ...(options.signal ? { signal: options.signal } : {}),
        },
        TRANSCRIBE_DEADLINE_MS,
      );
    },
    options.signal,
    {
      ...(options.onWait ? { onWait: options.onWait } : {}),
      ...(options.rateLimitBudgetMs === undefined
        ? {}
        : { rateLimitBudgetMs: options.rateLimitBudgetMs }),
    },
  );

  if (!response.ok) throw await failure(response, options.byok);

  const body = (await response.json()) as {
    segments?: { start?: number; end?: number; text?: string }[];
    words?: { start?: number; end?: number; word?: string }[];
    text?: string;
  };

  if (Array.isArray(body.segments) && body.segments.length > 0) {
    /**
     * Words arrive as one flat list for the whole upload, not nested inside the
     * segments, so they have to be dealt back out by time.
     */
    const words = Array.isArray(body.words)
      ? body.words
          .map((word) => ({
            startMs: Math.round((word.start ?? 0) * 1000),
            endMs: Math.round((word.end ?? 0) * 1000),
            text: (word.word ?? '').trim(),
          }))
          .filter((word) => word.text !== '')
      : [];

    const texts = body.segments.map((segment) => ({
      text: (segment.text ?? '').trim(),
    }));
    const perSegment = words.length > 0 ? partitionWords(texts, words) : texts.map(() => null);

    return (
      body.segments
        .map((segment, index) => ({
          startMs: Math.round((segment.start ?? 0) * 1000),
          endMs: Math.round((segment.end ?? 0) * 1000),
          text: texts[index]!.text,
          words: perSegment[index] ?? null,
        }))
        // Filtered *after* partitioning, so dropping an empty cue cannot shift
        // every later segment onto the wrong run of words.
        .filter((segment) => segment.text !== '')
    );
  }

  // Some responses carry only the flat text — a very short chunk, or silence
  // that produced no segment boundaries. Keeping it untimed is better than
  // discarding speech, and the merge step tolerates a zero-length span.
  const text = body.text?.trim();
  return text ? [{ startMs: 0, endMs: 0, text, words: null }] : [];
}

/** Whitespace removed, for comparing a word run against the text it should be. */
const strip = (value: string): string => value.replace(/\s+/gu, '');

/**
 * Deal the flat word list out to the segments, **by text rather than by time**.
 *
 * Whisper returns two views of the same speech: segments with text, and a flat
 * list of words. The words are in order and their concatenation *is* the
 * transcript, so the correct partition is the one that reconstructs each
 * segment's text exactly — consume words until they spell the segment, then
 * move on.
 *
 * Partitioning by timestamp instead is the obvious approach and it is wrong.
 * The two views are derived separately, so their boundaries disagree by tens of
 * milliseconds, and a word straddling a boundary lands on whichever side the
 * arithmetic favours rather than the side its sentence is on. Measured on a
 * real 40-minute episode, assigning by the midpoint of each word misplaced a
 * word in **146 of 593 segments** — one line ending "…get this thing off" while
 * the next began "the ground", when the transcript reads "…get this thing" /
 * "off the ground".
 *
 * That is not a timing inaccuracy, it is a *text* inaccuracy, and it is visible:
 * the player renders the active line from these words and every other line from
 * `segment.text`, so a misplaced word makes the line silently gain or lose a
 * word at the moment the highlight arrives on it.
 *
 * A segment whose words do not reconstruct it exactly gets null — better to
 * estimate that one line than to render text the transcript does not contain.
 */
/**
 * How far ahead to hunt for a segment's opening word after a failed match.
 *
 * Generously more than the longest cue Whisper emits, because the words that
 * have to be stepped over are those of the segment that just failed. Bounded
 * all the same: without a limit, a genuinely unmatchable segment would rescan
 * the remainder of the chunk for every segment left in it.
 */
const RESYNC_WORDS = 80;

/** The run of words starting at `start` that spells `target` exactly, if any. */
function matchFrom(
  words: TranscribedWord[],
  start: number,
  target: string,
): { taken: TranscribedWord[]; next: number } | null {
  const taken: TranscribedWord[] = [];
  let built = '';
  let i = start;

  while (i < words.length && built.length < target.length) {
    taken.push(words[i]!);
    built += strip(words[i]!.text);
    i += 1;
  }

  return built === target && taken.length > 0 ? { taken, next: i } : null;
}

export function partitionWords(
  segments: { text: string }[],
  words: TranscribedWord[],
): (TranscribedWord[] | null)[] {
  let cursor = 0;

  return segments.map((segment) => {
    const target = strip(segment.text);
    if (target === '') return null;

    // The common case: this segment begins exactly where the last one ended.
    let found = matchFrom(words, cursor, target);

    /**
     * Recovering from a segment that could not be spelled.
     *
     * Whisper's two views agree almost always and not quite always — a hyphen
     * the word stream splits and the segment text does not is enough to make
     * one line unmatchable. Without a way back, that single character cost the
     * entire remainder of a twenty-minute chunk: the failed segment left the
     * cursor stranded, every later segment started mid-stream and failed too,
     * and the sweep silently reverted to estimated timings for twenty minutes.
     *
     * So a failure advances nothing, and the *next* segment searches forward
     * for its own opening word. One bad line costs one bad line.
     */
    if (!found) {
      const limit = Math.min(words.length, cursor + RESYNC_WORDS);
      for (let start = cursor + 1; start < limit; start += 1) {
        found = matchFrom(words, start, target);
        if (found) break;
      }
    }

    if (!found) return null;

    cursor = found.next;
    return found.taken;
  });
}
