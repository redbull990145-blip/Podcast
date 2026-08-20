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

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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
 * Only transient classes are retried. A 401 is a wrong key and will be wrong
 * again; a 429 is a real rate limit where retrying immediately is the least
 * helpful possible response; a 413 is audio that is genuinely too big. Those
 * surface at once, with the message that tells the user what to do.
 */
const RETRY_STATUS = new Set([408, 500, 502, 503, 504, 522, 524]);
const MAX_ATTEMPTS = 3;

/** Backoff before attempt n (1-indexed): 1s, then 3s. Jittered. */
function backoffMs(attempt: number): number {
  return attempt * 1000 * (1 + Math.random() * 0.5) + (attempt - 1) * 1000;
}

/** Exported for its tests; every caller in this module goes through it. */
export async function withRetry(
  send: () => Promise<Response>,
  signal?: AbortSignal | undefined,
): Promise<Response> {
  let last: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await send();
      if (response.ok || !RETRY_STATUS.has(response.status)) return response;

      // The body has to be drained or the connection is held open for the life
      // of the process — and on the final attempt the caller reads it for the
      // error message, so only discard it when we are going round again.
      if (attempt === MAX_ATTEMPTS) return response;
      await response.body?.cancel();
      last = response.status;
    } catch (error) {
      // A dropped socket mid-upload is the same class of problem as a 502, and
      // on a 20MB request body it is not rare. An abort is not: that is the
      // caller having gone away, and retrying would ignore them.
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      if (attempt === MAX_ATTEMPTS) throw error;
      last = error;
    }

    await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
  }

  // Unreachable: the loop either returns or throws on its final attempt.
  throw last instanceof Error ? last : new AppError('upstream_unavailable', 'Groq did not respond');
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
  const response = await withRetry(
    () =>
      fetch(`${BASE_URL}/chat/completions`, {
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
      }),
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
  const response = await fetch(`${BASE_URL}/chat/completions`, {
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
  });

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
export async function transcribe(options: {
  key: string;
  byok: boolean;
  bytes: Uint8Array;
  filename: string;
  /** BCP-47 hint. Omitted lets Whisper detect, which is better than guessing wrong. */
  language?: string | null;
  signal?: AbortSignal;
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
  const response = await withRetry(() => {
    const form = new FormData();
    form.append('file', blob, options.filename);
    form.append('model', TRANSCRIBE_MODEL);
    form.append('response_format', 'verbose_json');
    // Repeated, not comma-joined: this is multipart form data, and the bracket
    // suffix is part of the literal field name Groq documents.
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');
    if (options.language) form.append('language', options.language);

    return fetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.key}` },
      body: form,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }, options.signal);

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

    const texts = body.segments.map((segment) => ({ text: (segment.text ?? '').trim() }));
    const perSegment =
      words.length > 0 ? partitionWords(texts, words) : texts.map(() => null);

    return body.segments
      .map((segment, index) => ({
        startMs: Math.round((segment.start ?? 0) * 1000),
        endMs: Math.round((segment.end ?? 0) * 1000),
        text: texts[index]!.text,
        words: perSegment[index] ?? null,
      }))
      // Filtered *after* partitioning, so dropping an empty cue cannot shift
      // every later segment onto the wrong run of words.
      .filter((segment) => segment.text !== '');
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
