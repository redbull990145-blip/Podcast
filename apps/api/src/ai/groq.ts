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
      max_tokens: options.maxTokens ?? 2048,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

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

export type TranscribedSegment = { startMs: number; endMs: number; text: string };

/**
 * Transcribe one piece of audio.
 *
 * `verbose_json` with segment granularity, because timings are the entire
 * reason to generate a transcript here rather than read the publisher's — a
 * flat wall of text is what they already ship, and it cannot drive follow-along
 * or chapters.
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
  const form = new FormData();

  // Copied into a fresh ArrayBuffer: chunks are subarrays of one large episode
  // buffer, and `new Blob([subarray])` would otherwise be free to reference the
  // whole backing store and upload far more than the slice.
  const copy = new Uint8Array(options.bytes.length);
  copy.set(options.bytes);

  form.append('file', new Blob([copy], { type: 'audio/mpeg' }), options.filename);
  form.append('model', TRANSCRIBE_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (options.language) form.append('language', options.language);

  const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${options.key}` },
    body: form,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) throw await failure(response, options.byok);

  const body = (await response.json()) as {
    segments?: { start?: number; end?: number; text?: string }[];
    text?: string;
  };

  if (Array.isArray(body.segments) && body.segments.length > 0) {
    return body.segments
      .map((segment) => ({
        startMs: Math.round((segment.start ?? 0) * 1000),
        endMs: Math.round((segment.end ?? 0) * 1000),
        text: (segment.text ?? '').trim(),
      }))
      .filter((segment) => segment.text !== '');
  }

  // Some responses carry only the flat text — a very short chunk, or silence
  // that produced no segment boundaries. Keeping it untimed is better than
  // discarding speech, and the merge step tolerates a zero-length span.
  const text = body.text?.trim();
  return text ? [{ startMs: 0, endMs: 0, text }] : [];
}
