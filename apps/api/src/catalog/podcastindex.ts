/**
 * PodcastIndex — where discovery data comes from.
 *
 * Chosen over Apple's iTunes Search API because it indexes ~4M feeds including
 * independent shows Apple never listed, and because its rate limiting is
 * per-key rather than Apple's ~20 requests/minute per IP, which one enthusiastic
 * user would exhaust for everybody.
 *
 * Results are cached in Redis. Search is the most repeated request in the
 * product and the upstream budget is shared by every user of this deployment,
 * so a cache hit is not an optimisation here — it is what keeps search working
 * for the second person who searches the same term.
 */

import { createHash } from 'node:crypto';
import type { Cache } from '../cache.ts';
import { cacheKey } from '../cache.ts';
import { AppError } from '../errors.ts';

const BASE_URL = 'https://api.podcastindex.org/api/1.0';
const TIMEOUT_MS = 10_000;

/** Search results change slowly; an hour is invisible to a user and cheap. */
const SEARCH_TTL_SEC = 60 * 60;
const TRENDING_TTL_SEC = 30 * 60;

export type PodcastIndexFeed = {
  id: number;
  title: string;
  url: string;
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  websiteUrl: string | null;
  language: string | null;
  categories: string[];
  explicit: boolean;
  episodeCount: number | null;
  lastPublishedAt: string | null;
};

export type PodcastIndexCredentials = { key: string; secret: string };

/** Raw upstream shape. Only the fields we use are declared. */
type RawFeed = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  author?: unknown;
  ownerName?: unknown;
  description?: unknown;
  image?: unknown;
  artwork?: unknown;
  link?: unknown;
  language?: unknown;
  categories?: unknown;
  explicit?: unknown;
  episodeCount?: unknown;
  newestItemPubdate?: unknown;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeFeed(raw: RawFeed): PodcastIndexFeed | null {
  const id = typeof raw.id === 'number' ? raw.id : null;
  const title = str(raw.title);
  const url = str(raw.url);

  // Without a feed URL there is nothing to subscribe to, so the result is
  // useless however good the metadata looks.
  if (id === null || !title || !url) return null;

  const categories =
    raw.categories && typeof raw.categories === 'object'
      ? Object.values(raw.categories as Record<string, unknown>)
          .map(str)
          .filter((name): name is string => name !== null)
      : [];

  // Unix seconds upstream; ISO on our wire, because JSON has no Date.
  const newest = typeof raw.newestItemPubdate === 'number' ? raw.newestItemPubdate : null;

  return {
    id,
    title,
    url,
    author: str(raw.author) ?? str(raw.ownerName),
    description: str(raw.description),
    // `artwork` is the higher-resolution of the two when present.
    artworkUrl: str(raw.artwork) ?? str(raw.image),
    websiteUrl: str(raw.link),
    language: str(raw.language)?.toLowerCase() ?? null,
    categories,
    explicit: raw.explicit === true || raw.explicit === 1,
    episodeCount: typeof raw.episodeCount === 'number' ? raw.episodeCount : null,
    lastPublishedAt: newest !== null ? new Date(newest * 1000).toISOString() : null,
  };
}

/**
 * PodcastIndex signs each request with `sha1(key + secret + unixSeconds)`.
 * The secret is only ever hashed, never sent.
 */
function authHeaders({ key, secret }: PodcastIndexCredentials): Record<string, string> {
  const seconds = Math.floor(Date.now() / 1000);
  const authorization = createHash('sha1')
    .update(key + secret + String(seconds))
    .digest('hex');

  return {
    'X-Auth-Key': key,
    'X-Auth-Date': String(seconds),
    Authorization: authorization,
    // PodcastIndex requires an identifiable agent and rejects requests without.
    'User-Agent': 'Cue/0.1',
  };
}

export type PodcastIndexClient = {
  search(query: string, options?: { language?: string; limit?: number }): Promise<PodcastIndexFeed[]>;
  trending(options?: { language?: string; limit?: number }): Promise<PodcastIndexFeed[]>;
  byFeedUrl(feedUrl: string): Promise<PodcastIndexFeed | null>;
};

export function createPodcastIndexClient(
  credentials: PodcastIndexCredentials | null,
  cache: Cache,
  fetchImpl: typeof fetch = fetch,
): PodcastIndexClient {
  async function request(path: string, params: Record<string, string>): Promise<RawFeed[]> {
    if (!credentials) {
      throw new AppError(
        'upstream_unavailable',
        'Podcast search is not configured on this server',
      );
    }

    const url = new URL(`${BASE_URL}${path}`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }

    let response: Response;
    try {
      response = await fetchImpl(url.href, {
        headers: authHeaders(credentials),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppError('upstream_unavailable', 'Podcast search is unavailable right now', {
        cause: error,
      });
    }

    if (response.status === 429) {
      throw new AppError('rate_limited', 'Search is busy — try again shortly', {
        retryAfterSec: 30,
      });
    }

    if (!response.ok) {
      throw new AppError('upstream_unavailable', 'Podcast search is unavailable right now');
    }

    const body = (await response.json()) as { feeds?: unknown };
    return Array.isArray(body.feeds) ? (body.feeds as RawFeed[]) : [];
  }

  async function cachedQuery(
    key: string,
    ttlSec: number,
    run: () => Promise<RawFeed[]>,
  ): Promise<PodcastIndexFeed[]> {
    const hit = await cache.get<PodcastIndexFeed[]>(key);
    if (hit) return hit;

    const feeds = (await run())
      .map(normalizeFeed)
      .filter((feed): feed is PodcastIndexFeed => feed !== null);

    // Cache even an empty result: a misspelled search is repeated more often
    // than a successful one, and it costs the same upstream call.
    await cache.set(key, feeds, ttlSec);
    return feeds;
  }

  return {
    async search(query, options = {}) {
      const normalized = query.trim().toLowerCase();

      return cachedQuery(cacheKey.search(normalized, options.language), SEARCH_TTL_SEC, () =>
        request('/search/byterm', {
          q: normalized,
          max: String(options.limit ?? 25),
          /*
            No `clean` parameter, and it is worth being explicit about why it is
            absent rather than leaving a silence for somebody to helpfully fill.

            This used to send `clean: '1'` under the comment "ask upstream to
            drop dead feeds rather than filtering them here". That is not what
            the flag does. In the PodcastIndex API `clean` means *return only
            feeds marked non-explicit* — it has nothing to do with dead feeds —
            so the effect was that every explicit show in the index was
            invisible to search. Call Her Daddy, My Favorite Murder and Behind
            the Bastards all returned zero results while "daddy" on its own
            returned twenty-five, which is the shape of a search that looks
            merely bad at its job rather than one that is filtering a whole
            category out.

            Explicitness is carried through to the client on the feed's own
            `explicit` field, which is where a decision about showing it
            belongs — a listener searching for a show by name has already
            decided.
          */
          ...(options.language ? { lang: options.language } : {}),
        }),
      );
    },

    async trending(options = {}) {
      return cachedQuery(cacheKey.trending(options.language), TRENDING_TTL_SEC, () =>
        request('/podcasts/trending', {
          max: String(options.limit ?? 25),
          ...(options.language ? { lang: options.language } : {}),
        }),
      );
    },

    async byFeedUrl(feedUrl) {
      const feeds = await request('/podcasts/byfeedurl', { url: feedUrl });
      const first = feeds[0];
      return first ? normalizeFeed(first) : null;
    },
  };
}
