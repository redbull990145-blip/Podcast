import { createHash } from "node:crypto";

/**
 * Podcast discovery across two free catalogues.
 *
 * iTunes has the best coverage of mainstream shows and needs no key, so it is
 * the fast path. PodcastIndex covers independent and niche shows that iTunes
 * either buries or never listed, which is the specific complaint this app is
 * trying to answer — so results from both are merged rather than falling back
 * to one only when the other is empty.
 */

export type PodcastSearchResult = {
  /** Stable key for React lists and dedupe. Always the feed URL. */
  feedUrl: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  description: string | null;
  categories: string[];
  episodeCount: number | null;
  itunesId: number | null;
  podcastindexId: number | null;
  /** Which catalogue surfaced this, shown as a small provenance hint. */
  sources: ("itunes" | "podcastindex")[];
};

const SEARCH_TIMEOUT_MS = 6_000;

async function timedFetch(url: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res.ok ? res : null;
  } catch {
    // A catalogue being down must degrade to "fewer results", never an error
    // page — the other catalogue and add-by-RSS still work.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// iTunes Search API — no key required
// ---------------------------------------------------------------------------

type ItunesResult = {
  collectionId?: number;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  genres?: string[];
  trackCount?: number;
};

export async function searchItunes(term: string, limit = 25) {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    media: "podcast",
    entity: "podcast",
    term,
    limit: String(limit),
  })}`;

  const res = await timedFetch(url);
  if (!res) return [];

  const data = (await res.json().catch(() => null)) as
    | { results?: ItunesResult[] }
    | null;
  if (!data?.results) return [];

  return data.results
    .filter((r): r is ItunesResult & { feedUrl: string } => Boolean(r.feedUrl))
    .map<PodcastSearchResult>((r) => ({
      feedUrl: r.feedUrl,
      title: r.collectionName ?? r.trackName ?? "Untitled podcast",
      author: r.artistName ?? null,
      artworkUrl: r.artworkUrl600 ?? r.artworkUrl100 ?? null,
      description: null, // iTunes search does not return one.
      // "Podcasts" is on nearly every result and carries no signal for the
      // recommender, so drop it here rather than teaching the scorer to ignore it.
      categories: (r.genres ?? []).filter((g) => g.toLowerCase() !== "podcasts"),
      episodeCount: r.trackCount ?? null,
      itunesId: r.collectionId ?? null,
      podcastindexId: null,
      sources: ["itunes"],
    }));
}

// ---------------------------------------------------------------------------
// PodcastIndex API — free key, better independent coverage
// ---------------------------------------------------------------------------

type PodcastIndexFeed = {
  id?: number;
  url?: string;
  title?: string;
  author?: string;
  ownerName?: string;
  image?: string;
  artwork?: string;
  description?: string;
  categories?: Record<string, string> | null;
  episodeCount?: number;
  itunesId?: number | null;
};

/**
 * PodcastIndex signs each request with sha1(key + secret + unix seconds).
 * Requests more than a few minutes out of sync are rejected.
 */
function podcastIndexHeaders(key: string, secret: string): HeadersInit {
  const authDate = Math.floor(Date.now() / 1000).toString();
  const authorization = createHash("sha1")
    .update(key + secret + authDate)
    .digest("hex");

  return {
    "X-Auth-Key": key,
    "X-Auth-Date": authDate,
    Authorization: authorization,
    "User-Agent": "Cadence/0.1",
  };
}

export function hasPodcastIndexCredentials(): boolean {
  return Boolean(process.env.PODCASTINDEX_API_KEY && process.env.PODCASTINDEX_API_SECRET);
}

export async function searchPodcastIndex(term: string, limit = 25) {
  const key = process.env.PODCASTINDEX_API_KEY;
  const secret = process.env.PODCASTINDEX_API_SECRET;
  // Without a key we simply return nothing; iTunes still covers search.
  if (!key || !secret) return [];

  const url = `https://api.podcastindex.org/api/1.0/search/byterm?${new URLSearchParams(
    { q: term, max: String(limit) },
  )}`;

  const res = await timedFetch(url, { headers: podcastIndexHeaders(key, secret) });
  if (!res) return [];

  const data = (await res.json().catch(() => null)) as
    | { feeds?: PodcastIndexFeed[] }
    | null;
  if (!data?.feeds) return [];

  return data.feeds
    .filter((f): f is PodcastIndexFeed & { url: string } => Boolean(f.url))
    .map<PodcastSearchResult>((f) => ({
      feedUrl: f.url,
      title: f.title ?? "Untitled podcast",
      author: f.author ?? f.ownerName ?? null,
      artworkUrl: f.artwork ?? f.image ?? null,
      description: f.description ?? null,
      categories: f.categories ? Object.values(f.categories) : [],
      episodeCount: f.episodeCount ?? null,
      itunesId: f.itunesId ?? null,
      podcastindexId: f.id ?? null,
      sources: ["podcastindex"],
    }));
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Feed URLs differ cosmetically between catalogues; compare them normalized. */
function feedKey(feedUrl: string): string {
  try {
    const url = new URL(feedUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return feedUrl.toLowerCase();
  }
}

/**
 * Merges results from both catalogues, preferring whichever entry carries more
 * detail and recording every source that returned it.
 */
export function mergeResults(
  ...lists: PodcastSearchResult[][]
): PodcastSearchResult[] {
  const byKey = new Map<string, PodcastSearchResult>();

  for (const list of lists) {
    for (const result of list) {
      const key = feedKey(result.feedUrl);
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, { ...result });
        continue;
      }

      // Fill gaps from the duplicate rather than discarding it: iTunes has
      // better artwork, PodcastIndex has descriptions and richer categories.
      byKey.set(key, {
        ...existing,
        description: existing.description ?? result.description,
        artworkUrl: existing.artworkUrl ?? result.artworkUrl,
        author: existing.author ?? result.author,
        episodeCount: existing.episodeCount ?? result.episodeCount,
        itunesId: existing.itunesId ?? result.itunesId,
        podcastindexId: existing.podcastindexId ?? result.podcastindexId,
        categories:
          existing.categories.length >= result.categories.length
            ? existing.categories
            : result.categories,
        sources: [...new Set([...existing.sources, ...result.sources])],
      });
    }
  }

  return [...byKey.values()];
}

/** Searches both catalogues in parallel and returns merged results. */
export async function searchPodcasts(
  term: string,
  limit = 25,
): Promise<PodcastSearchResult[]> {
  const query = term.trim();
  if (!query) return [];

  // Promise.all is safe here because each searcher swallows its own failures.
  const [itunes, podcastIndex] = await Promise.all([
    searchItunes(query, limit),
    searchPodcastIndex(query, limit),
  ]);

  return mergeResults(itunes, podcastIndex).slice(0, limit);
}
