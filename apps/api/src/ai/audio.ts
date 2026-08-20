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

const USER_AGENT = 'Cue/0.1 (+https://github.com/redbull990145-blip/Podcast)';

const MAX_REDIRECTS = 5;

/**
 * Ceiling on an episode download.
 *
 * The binding constraint is memory, not bandwidth: this is buffered whole so
 * frame boundaries can be walked, and each chunk is copied again on its way to
 * the upload. 120MB is about two hours at 128kbps, which covers the
 * overwhelming majority of shows, and stays survivable on a small container.
 *
 * Longer episodes are refused with a message that says so rather than being
 * truncated into a transcript that silently stops halfway.
 */
const MAX_BYTES = 120 * 1024 * 1024;

/** Generous, because this is tens of megabytes over whatever connection exists. */
const TIMEOUT_MS = 180_000;

export type AudioOutcome =
  | { status: 'ok'; bytes: Uint8Array; contentType: string | null }
  /**
   * `permanent` means retrying cannot help.
   *
   * The queue retries three times, which is right for a dropped connection or
   * a publisher's 503 and pure waste for anything about the file itself. An
   * episode that is too big will be exactly as big on the third attempt — so
   * without this flag the app downloads up to 120MB three times, holds the
   * listener on "Writing captions…" for several minutes, and only then tells
   * them something it knew within seconds of the first try.
   *
   * Absent means transient, deliberately: a new failure mode nobody has
   * classified should cost a retry, not a false dead end.
   */
  | { status: 'error'; detail: string; permanent?: boolean };

export async function fetchAudio(
  url: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<AudioOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = await checkUrl(currentUrl);
    if (!check.allowed) return { status: 'error', detail: check.detail };

    let response: Response;
    try {
      response = await doFetch(check.url.href, {
        headers: { 'user-agent': USER_AGENT, accept: 'audio/*, */*;q=0.8' },
        redirect: 'manual',
        signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      });
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

    if (!response.ok) {
      return {
        status: 'error',
        detail: `Publisher returned ${response.status}`,
        // A 4xx is the publisher saying the file is not there; a 5xx may well
        // be gone by the next attempt.
        permanent: response.status < 500,
      };
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) {
      return {
        status: 'error',
        detail: 'That episode is too long to transcribe',
        permanent: true,
      };
    }

    if (!response.body) {
      return { status: 'error', detail: 'The publisher sent no audio', permanent: true };
    }

    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        total += value.byteLength;
        // Checked as it arrives: `content-length` comes from the same server
        // that would be lying about it, so it cannot be the only ceiling.
        if (total > MAX_BYTES) {
          await reader.cancel();
          return {
            status: 'error',
            detail: 'That episode is too long to transcribe',
            permanent: true,
          };
        }

        parts.push(value);
      }
    } catch (error) {
      return {
        status: 'error',
        detail: error instanceof Error ? error.message : 'The download failed',
      };
    } finally {
      reader.releaseLock();
    }

    if (total === 0) return { status: 'error', detail: 'The publisher sent an empty file' };

    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.byteLength;
    }

    return { status: 'ok', bytes, contentType: response.headers.get('content-type') };
  }

  return { status: 'error', detail: `More than ${MAX_REDIRECTS} redirects` };
}
