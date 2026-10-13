/**
 * Pulling an episode's audio down long enough to transcribe it.
 *
 * The same SSRF guard as feeds, and for the same reason: an enclosure URL comes
 * out of RSS that anyone can publish, so it is exactly as attacker-controlled
 * as the feed that carried it. Redirects are re-checked at every hop — podcast
 * audio redirects constantly, through analytics prefixes and CDN hostnames, and
 * `redirect: 'follow'` would let hop two land inside a private network.
 *
 * Nothing is stored. The bytes exist for the length of one transcription and
 * are then garbage; this project streams publisher audio and keeps none of it,
 * and that does not change just because we read it once ourselves.
 */

import { checkUrl } from '../feed/url-guard.ts';
import { fetchChecked } from '../feed/pinned-fetch.ts';
import { concatAllForFallback, Mp3ChunkStream, type Mp3Chunk } from './mp3.ts';

const USER_AGENT = 'Cue/0.1 (+https://github.com/redbull990145-blip/Podcast)';

const MAX_REDIRECTS = 5;

/**
 * Ceiling on a single download.
 *
 * No longer a memory constraint. Audio used to be buffered whole before being
 * split, which made the ceiling here a proxy for "how much RAM one job may
 * hold" — 120MB, chosen as roughly two hours at 128kbps, on the reasoning that
 * it "covers the overwhelming majority of shows." It did not cover this one: a
 * real 2h34m episode in this catalogue, encoded at 320kbps for a Spotify-hosted
 * ad-insertion pipeline, is 352MB, and got the same "too long to transcribe"
 * refusal a genuinely oversized file would.
 *
 * `streamAudioChunks` below never holds more than roughly one upload's worth of
 * audio in memory regardless of the episode's length, so this ceiling is free
 * to track what listeners actually have rather than what used to be
 * survivable. 500MB comfortably covers a three-and-a-half-hour episode at a
 * full 320kbps — the highest bitrate observed anywhere in this catalogue — and
 * what remains is a sanity limit against a malformed or hostile enclosure
 * claiming to be arbitrarily large, not a memory budget.
 */
const MAX_BYTES = 500 * 1024 * 1024;

/** Generous, because this is hundreds of megabytes over whatever connection exists. */
const TIMEOUT_MS = 600_000;

export type AudioError = {
  status: 'error';
  detail: string;
  /**
   * `permanent` means retrying cannot help.
   *
   * The queue retries three times, which is right for a dropped connection or
   * a publisher's 503 and pure waste for anything about the file itself. An
   * episode that is too big will be exactly as big on the third attempt — so
   * without this flag the app downloads hundreds of megabytes three times,
   * holds the listener on "Writing captions…" for several minutes, and only
   * then tells them something it knew within seconds of the first try.
   *
   * Absent means transient, deliberately: a new failure mode nobody has
   * classified should cost a retry, not a false dead end.
   */
  permanent?: boolean;
};

/**
 * Resolve redirects and hand back the response body, still unread.
 *
 * The half of `fetchAudio`'s old job that has nothing to do with buffering:
 * the SSRF re-check per hop, the manual redirect walk, and turning an HTTP
 * failure into the right `AudioError`. Shared by both consumers below so
 * neither can drift from the other on what counts as safe.
 */
async function resolveAudioResponse(
  url: string,
  doFetch: typeof fetch | undefined,
  signal: AbortSignal | undefined,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: 'ok'; response: Response; finalUrl: URL } | AudioError> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = await checkUrl(currentUrl);
    if (!check.allowed) return { status: 'error', detail: check.detail };

    let response: Response;
    try {
      response = await fetchChecked(check, {
        headers: { 'user-agent': USER_AGENT, accept: 'audio/*, */*;q=0.8', ...extraHeaders },
        redirect: 'manual',
        signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
      }, doFetch);
    } catch (error) {
      return {
        status: 'error',
        detail: error instanceof Error ? error.message : 'Could not reach the audio',
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { status: 'error', detail: 'Redirect without a Location header' };
      currentUrl = new URL(location, check.url).href;
      continue;
    }

    // `response.ok` is 200-299, which already covers the 206 a ranged request
    // gets back — spelled out here only because the ranged reader below depends
    // on 206 reaching it rather than being classified as a publisher error.
    if (!response.ok) {
      return {
        status: 'error',
        detail: `Publisher returned ${response.status}`,
        // A 4xx is the publisher saying the file is not there; a 5xx may well
        // be gone by the next attempt.
        permanent: response.status < 500,
      };
    }

    return { status: 'ok', response, finalUrl: check.url };
  }

  return { status: 'error', detail: `More than ${MAX_REDIRECTS} redirects` };
}

export type StreamAudioOutcome =
  | { status: 'ok'; audioDurationMs: number; audioBytes: number }
  | AudioError
  /**
   * Downloaded fine, but nothing in it was ever recognisable as an MP3 frame
   * and it ran past `chunkBytes` — too big to send Groq whole, and this is the
   * one audio format this project can split without an FFmpeg dependency (see
   * `mp3.ts`). Distinct from `error` because nothing actually went wrong: the
   * file is exactly what the publisher sent, we simply cannot cut it up.
   */
  | { status: 'unsplittable'; audioBytes: number };

/**
 * Download an episode and hand its audio to `onChunk` as upload-sized pieces
 * become available, instead of returning the whole thing at once.
 *
 * This is the fix for the memory problem `MAX_BYTES`'s doc explains: an
 * `Mp3ChunkStream` never holds more than roughly one chunk's worth of data, so
 * a three-hour high-bitrate episode costs the same working memory as a
 * ten-minute one. `onChunk` is awaited before the next network read is
 * requested, which is what keeps that true — it also means the caller's own
 * upload pace is what paces the download, with no separate throttling needed.
 *
 * Preserves the small-file behaviour the old whole-buffer path had: audio that
 * never resolves to a single MP3 frame *and* stays within `chunkBytes` the
 * whole way through is handed to `onChunk` once, untouched, on the reasoning
 * that Whisper reads several containers this code cannot parse and the right
 * answer is to let it try rather than refuse on our own uncertainty.
 */
export async function streamAudioChunks(
  url: string,
  chunkBytes: number,
  onChunk: (chunk: Mp3Chunk) => Promise<void>,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    /**
     * Told the declared size, once the response headers are in — before a
     * single byte of audio has arrived.
     *
     * The download itself can be the longest silent stretch in the whole job:
     * a three-hour, 320kbps episode is 350MB, and nothing is available to
     * report until the first `chunkBytes` of it exist to cut a piece from.
     * Without this the caller has nothing to say for that entire stretch
     * beyond "starting up," which reads identically whether the job is slow
     * or dead. `null` when the publisher sent no `content-length` at all,
     * which is common enough that the caller has to have an answer for it.
     */
    onStarted?: (declaredBytes: number | null) => void;
  } = {},
): Promise<StreamAudioOutcome> {
  const resolved = await resolveAudioResponse(url, options.fetchImpl, options.signal);
  if (resolved.status === 'error') return resolved;

  const { response } = resolved;

  // Rejected before a single byte is read, when the publisher says enough to
  // know: no point spending minutes downloading hundreds of megabytes to reach
  // a conclusion their own header already gave away.
  const declaredHeader = response.headers.get('content-length');
  const declared = Number(declaredHeader ?? '0');
  if (declared > MAX_BYTES) {
    return { status: 'error', detail: 'That episode is too long to transcribe', permanent: true };
  }

  options.onStarted?.(declaredHeader !== null && declared > 0 ? declared : null);

  if (!response.body) return { status: 'error', detail: 'The publisher sent no audio', permanent: true };

  const chunker = new Mp3ChunkStream(chunkBytes);
  const reader = response.body.getReader();

  let total = 0;
  let mp3Emitted = false;

  // Kept only while the download could still turn out to be the small,
  // never-recognised-as-MP3 case — discarded the moment either condition
  // stops holding, so it never grows past `chunkBytes`.
  const rawBuffer: Uint8Array[] = [];
  let rawEligible = true;

  try {
    for (;;) {
      /*
        Only the read itself is guarded here — not what happens with what it
        returns.

        `onChunk` calls back into `transcribeChunk`, which throws a fully-formed
        `AppError` for a rate limit, a rejected key, or Groq being down —
        exactly the classification `runJob`'s own `catch` already knows how to
        read (`isPermanent`, the retry-after on a 429, and so on). An earlier
        version of this wrapped the whole loop body in one `try`, so an upload
        failure was caught here too and flattened into a generic download
        error: a Groq rate limit came out as "Could not fetch the audio: The
        shared AI allowance is busy right now," which is true in no useful
        sense and threw away the `retryAfterSec` the caller needed. Keeping the
        `try` around only the read lets an upload's own error propagate as
        itself.
      */
      let read: Awaited<ReturnType<typeof reader.read>>;
      try {
        read = await reader.read();
      } catch (error) {
        return {
          status: 'error',
          detail: error instanceof Error ? error.message : 'The download failed',
        };
      }

      if (read.done) break;
      const value = read.value;

      total += value.byteLength;
      // Checked as it arrives: `content-length` comes from the same server
      // that would be lying about it, so it cannot be the only ceiling — and
      // plenty of hosts omit it entirely.
      if (total > MAX_BYTES) {
        await reader.cancel();
        return { status: 'error', detail: 'That episode is too long to transcribe', permanent: true };
      }

      if (rawEligible) {
        rawBuffer.push(value);
        if (total > chunkBytes) {
          rawEligible = false;
          rawBuffer.length = 0;
        }
      }

      for (const chunk of chunker.push(value)) {
        mp3Emitted = true;
        await onChunk(chunk);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) return { status: 'error', detail: 'The publisher sent an empty file' };

  for (const chunk of chunker.finish()) {
    mp3Emitted = true;
    await onChunk(chunk);
  }

  if (!mp3Emitted) {
    if (!rawEligible) return { status: 'unsplittable', audioBytes: total };

    await onChunk({ bytes: concatAllForFallback(rawBuffer), startMs: 0, durationMs: 0 });
  }

  return { status: 'ok', audioDurationMs: chunker.totalDurationMs, audioBytes: total };
}

// ------------------------------------------------------------------ ranged --

export type AudioRange = {
  status: 'ok';
  bytes: Uint8Array;
  /**
   * Size of the *whole* file, read from `Content-Range`.
   *
   * Null when the publisher ignored the range request, because then there is no
   * `Content-Range` to read and `Content-Length` describes the body we truncated
   * rather than the file. Guessing in that case would produce a confident number
   * that is wrong by however much we chose not to download.
   */
  totalBytes: number | null;
  /** Whether the range was honoured (206) or the whole file was offered (200). */
  ranged: boolean;
};

/**
 * Read one byte range of an episode, without downloading the rest.
 *
 * This is what makes checking a transcript's alignment affordable. `streamAudioChunks`
 * above is the right tool when the whole episode has to be transcribed; it is
 * absurdly the wrong one for answering "how long is this file really" or "what
 * is being said at 22 minutes", which need a few kilobytes from a known offset.
 *
 * **A 200 is handled rather than refused.** Some publishers, and more CDNs than
 * you would hope, ignore `Range` and start sending the entire file. Treating
 * that as an error would give up on hosts that are actually working fine, so the
 * body is read only as far as the requested end and then cancelled — the
 * connection closes, the remaining bytes are never transferred, and the caller
 * gets what it asked for. `ranged: false` tells it the offsets came from a
 * whole-file read, which matters because only a `Content-Range` can report the
 * true total.
 */
export async function fetchAudioRange(
  url: string,
  from: number,
  to: number,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<AudioRange | AudioError> {
  if (to < from) return { status: 'error', detail: 'Empty byte range', permanent: true };

  const want = to - from + 1;
  if (want > MAX_BYTES) {
    return { status: 'error', detail: 'Range is too large', permanent: true };
  }

  const resolved = await resolveAudioResponse(
    url,
    options.fetchImpl,
    options.signal,
    { range: `bytes=${from}-${to}` },
  );
  if (resolved.status === 'error') return resolved;

  const { response } = resolved;
  const ranged = response.status === 206;

  /**
   * `bytes 0-100/48320613` — the total is the part after the slash.
   *
   * `*` is legal there and means the server will not say, so it is read as
   * unknown rather than coerced to zero.
   */
  let totalBytes: number | null = null;
  const contentRange = response.headers.get('content-range');
  if (ranged && contentRange) {
    const total = /\/\s*(\d+)\s*$/.exec(contentRange)?.[1];
    if (total) totalBytes = Number(total);
  }
  if (!ranged) {
    const length = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(length) && length > 0) totalBytes = length;
  }

  if (!response.body) {
    return { status: 'error', detail: 'The publisher sent no audio', permanent: true };
  }

  // The range we asked for starts at `from`; a server that ignored the request
  // is sending from zero, so that much has to be skipped on the way past.
  const skip = ranged ? 0 : from;
  const need = skip + want;

  const parts: Uint8Array[] = [];
  let read = 0;
  const reader = response.body.getReader();

  try {
    while (read < need) {
      let next: Awaited<ReturnType<typeof reader.read>>;
      try {
        next = await reader.read();
      } catch (error) {
        return {
          status: 'error',
          detail: error instanceof Error ? error.message : 'The download failed',
        };
      }

      if (next.done) break;
      parts.push(next.value);
      read += next.value.byteLength;
    }
  } finally {
    // Cancel rather than drain: on the 200 path the file may have hundreds of
    // megabytes still to come, and every one of them is bytes nobody wanted.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (read === 0) return { status: 'error', detail: 'The publisher sent an empty range' };

  const joined = concatAllForFallback(parts);
  return { status: 'ok', bytes: joined.subarray(skip, need), totalBytes, ranged };
}
