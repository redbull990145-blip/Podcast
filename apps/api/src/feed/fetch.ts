/**
 * Fetching a feed from a publisher we do not control.
 *
 * Every constraint here exists because feeds in the wild break in that exact
 * way: they redirect through three hosts, they never close the connection,
 * they serve a 400MB file, they return 200 with an HTML error page, and a
 * meaningful number of them block any client that doesn't identify itself.
 *
 * Redirects are followed manually so every hop is re-checked against the SSRF
 * guard. `redirect: 'follow'` would let a public URL bounce us into a private
 * network on hop two, which is the whole attack.
 */

import { checkUrl } from './url-guard.ts';

/** Polite and identifiable. Several large hosts 403 an unknown agent. */
const USER_AGENT = 'Cue/0.1 (+https://github.com/redbull990145-blip/Podcast)';

const MAX_REDIRECTS = 5;

/**
 * Feed size ceiling.
 *
 * Measured against real shows rather than guessed: NYT's The Daily ships an
 * 18.5MB feed and The Changelog 6.2MB, so a 10MB cap silently refuses some of
 * the most popular podcasts in the world — a product hole disguised as a
 * safety limit.
 *
 * The real constraint is memory, not bytes on the wire: the body is buffered
 * as a string and then parsed into an object tree several times its size. 32MB
 * clears the largest feeds we can find with headroom, while staying inside
 * what a 512MB container survives — and ingest is on the `expensive` rate-limit
 * tier, so concurrent parses of this size are bounded.
 */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Total deadline, covering the body download and not just the response
 * headers. 20s was not enough to pull an 18.5MB feed on an ordinary
 * connection, which turned the largest shows into timeouts. Measured: The
 * Daily takes ~40s cold, so this leaves real headroom.
 *
 * This is a one-time cost per feed — every later refresh is a conditional
 * request that returns 304 with no body.
 *
 * NOTE for deployment: a 60s inline fetch will outlive the request timeout on
 * some hosts. The fix is to move first-time ingest of very large feeds to a
 * background job and have the client poll, which belongs with the job queue
 * rather than here. Until then, adding a feed this size can time out at the
 * platform's edge even though the ingest itself is fine.
 */
const TIMEOUT_MS = 60_000;

export type FetchOutcome =
  /** Feed body, ready to parse. */
  | {
      status: 'ok';
      body: string;
      etag: string | null;
      lastModified: string | null;
      /** After redirects — this is what we store as the canonical feed URL. */
      finalUrl: string;
    }
  /** Server confirmed nothing changed. No body, no parse, no writes. */
  | { status: 'not-modified' }
  /** The feed is gone for good; stop polling it. */
  | { status: 'gone'; detail: string }
  /** Transient or rejected — safe to retry later. */
  | { status: 'error'; detail: string; retryable: boolean };

export type FetchOptions = {
  etag?: string | null;
  lastModified?: string | null;
  /** Injectable so tests never touch the network. */
  fetchImpl?: typeof fetch;
};

/**
 * Read a response body with a hard ceiling.
 *
 * `await response.text()` would happily buffer a feed that claims to be
 * infinite. Streaming with a running total lets us abort partway rather than
 * finding out after the memory is already gone — and a `Content-Length` header
 * can't be trusted, since it's supplied by the same server.
 */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return null;

  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Feeds are overwhelmingly UTF-8; `fatal: false` means a stray bad byte
  // becomes a replacement character instead of losing the whole episode list.
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

export async function fetchFeed(url: string, options: FetchOptions = {}): Promise<FetchOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = await checkUrl(currentUrl);
    if (!check.allowed) {
      // A rejected redirect target is not retryable — it will resolve the same
      // way next time, and retrying an SSRF attempt is just doing it again.
      return { status: 'error', detail: check.detail, retryable: false };
    }

    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      'accept-encoding': 'gzip, deflate',
    };

    // Only send conditional headers on the first hop. After a redirect they
    // describe a different resource.
    if (hop === 0) {
      if (options.etag) headers['if-none-match'] = options.etag;
      if (options.lastModified) headers['if-modified-since'] = options.lastModified;
    }

    let response: Response;
    try {
      response = await doFetch(check.url.href, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Request failed';
      return { status: 'error', detail, retryable: true };
    }

    if (response.status === 304) return { status: 'not-modified' };

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { status: 'error', detail: 'Redirect without a Location header', retryable: false };
      }
      // Relative Locations are legal and common.
      currentUrl = new URL(location, check.url).href;
      continue;
    }

    // 404 and 410 mean the publisher took it down. Retrying forever is how a
    // refresh cycle fills with dead feeds.
    if (response.status === 404 || response.status === 410) {
      return { status: 'gone', detail: `Publisher returned ${response.status}` };
    }

    if (!response.ok) {
      return {
        status: 'error',
        detail: `Publisher returned ${response.status}`,
        // 5xx and 429 are the publisher's problem and may pass.
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    // Reading the body is a second place the request can fail — the timeout
    // signal fires here too, on a slow download. Leaving this outside a
    // try/catch let an abort escape as an uncaught exception and take the
    // process with it.
    let body: string | null;
    try {
      body = await readCapped(response);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed while reading the feed';
      return { status: 'error', detail, retryable: true };
    }

    if (body === null) {
      return { status: 'error', detail: 'Feed is too large to process', retryable: false };
    }

    if (body.trim().length === 0) {
      return { status: 'error', detail: 'Feed was empty', retryable: true };
    }

    return {
      status: 'ok',
      body,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      finalUrl: check.url.href,
    };
  }

  return { status: 'error', detail: `More than ${MAX_REDIRECTS} redirects`, retryable: false };
}
