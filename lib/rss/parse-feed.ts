import Parser from "rss-parser";
import { assertSafeFeedUrl, UnsafeUrlError } from "./url-guard";
import type { Chapter } from "@/lib/db/schema";

/**
 * RSS ingestion.
 *
 * Every field here is optional in the wild. Feeds routinely omit guids, encode
 * durations three different ways, and nest artwork under whichever namespace
 * the publishing tool preferred. The parser's job is to never throw on a
 * badly-formed feed — a show with a missing field should degrade to a show with
 * a missing field, not a 500.
 */

export type ParsedEpisode = {
  guid: string;
  title: string;
  description: string | null;
  enclosureUrl: string;
  enclosureType: string | null;
  enclosureLength: number | null;
  durationSeconds: number | null;
  episodeNumber: number | null;
  seasonNumber: number | null;
  imageUrl: string | null;
  publishedAt: Date | null;
  /** <podcast:chapters url="..."> — fetched lazily, not during feed parse. */
  chaptersUrl: string | null;
  transcriptUrl: string | null;
};

export type ParsedFeed = {
  title: string;
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  categories: string[];
  language: string | null;
  link: string | null;
  lastBuildDate: Date | null;
  episodes: ParsedEpisode[];
};

export type FetchFeedResult =
  | { status: "ok"; feed: ParsedFeed; etag: string | null; lastModified: string | null }
  /** The publisher confirmed nothing changed — skip the parse entirely. */
  | { status: "not-modified" }
  | { status: "error"; message: string };

/** 10 MB. Some video-podcast feeds are enormous; none legitimately exceed this. */
const MAX_FEED_BYTES = 10 * 1024 * 1024;

/** Vercel Hobby caps functions at 10s, so leave room to parse and respond. */
const FETCH_TIMEOUT_MS = 8_000;

const USER_AGENT =
  "Cadence/0.1 (podcast aggregator; +https://github.com/redbull990145-blip/Podcast)";

type FeedFields = {
  "itunes:author"?: string;
  "itunes:image"?: { $?: { href?: string } };
  /** Repeated tag — collected via keepArray, so always an array when present. */
  itunesCategories?: unknown;
  "podcast:medium"?: string;
  // rss-parser's Output type omits these standard RSS channel elements even
  // though it parses them, so they are declared here rather than cast at use.
  language?: string;
  managingEditor?: string;
  lastBuildDate?: string;
  image?: { url?: string };
};

type ItemFields = {
  "itunes:duration"?: string;
  "itunes:episode"?: string;
  "itunes:season"?: string;
  "itunes:image"?: { $?: { href?: string } };
  "itunes:summary"?: string;
  "podcast:chapters"?: { $?: { url?: string; type?: string } };
  /** Repeated tag — one entry per transcript format the publisher offers. */
  podcastTranscripts?: unknown;
  "content:encoded"?: string;
};

/**
 * A show can declare several <itunes:category> tags and an episode several
 * <podcast:transcript> tags. Without keepArray, rss-parser keeps only the last
 * occurrence of a repeated element, which silently drops categories the
 * recommender needs and transcript formats we prefer.
 */
const parser: Parser<FeedFields, ItemFields> = new Parser({
  customFields: {
    feed: [
      "itunes:author",
      "itunes:image",
      ["itunes:category", "itunesCategories", { keepArray: true }],
      "podcast:medium",
    ],
    item: [
      "itunes:duration",
      "itunes:episode",
      "itunes:season",
      "itunes:image",
      "itunes:summary",
      "podcast:chapters",
      ["podcast:transcript", "podcastTranscripts", { keepArray: true }],
      "content:encoded",
    ],
    // rss-parser's published types model custom fields as plain strings and do
    // not describe the [tag, alias, options] tuple that keepArray requires,
    // even though the runtime supports it. The tuples above are correct.
  } as unknown as Parser.ParserOptions<FeedFields, ItemFields>["customFields"],
});

/**
 * "3600" -> 3600, "1:02:03" -> 3723, "45:30" -> 2730.
 *
 * The bare-seconds form and the clock form are both common, and some feeds pad
 * with whitespace or append junk.
 */
export function parseDuration(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map((p) => Number(p.trim()));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

  const seconds =
    nums.length === 3
      ? nums[0] * 3600 + nums[1] * 60 + nums[2]
      : nums[0] * 60 + nums[1];

  return seconds > 0 ? seconds : null;
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseIntOrNull(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * itunes:category arrives as a string, an object with attributes, or an array
 * of either, sometimes with nested subcategories. Flatten whatever we get.
 */
function extractCategories(raw: unknown): string[] {
  const out: string[] = [];

  const visit = (node: unknown): void => {
    if (!node) return;
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (trimmed) out.push(trimmed);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const attrs = obj.$ as Record<string, unknown> | undefined;
      if (attrs && typeof attrs.text === "string") {
        const trimmed = attrs.text.trim();
        if (trimmed) out.push(trimmed);
      }
      // Nested <itunes:category> children.
      visit(obj["itunes:category"]);
    }
  };

  visit(raw);
  // Case-insensitive dedupe, first spelling wins.
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = c.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** <podcast:transcript> may repeat for different formats; prefer VTT, then SRT. */
function extractTranscriptUrl(raw: unknown): string | null {
  const candidates: { url: string; type: string }[] = [];

  const visit = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "object") {
      const attrs = (node as Record<string, unknown>).$ as
        | Record<string, unknown>
        | undefined;
      if (attrs && typeof attrs.url === "string") {
        candidates.push({
          url: attrs.url,
          type: typeof attrs.type === "string" ? attrs.type.toLowerCase() : "",
        });
      }
    }
  };

  visit(raw);
  if (candidates.length === 0) return null;

  const preferred =
    candidates.find((c) => c.type.includes("vtt")) ??
    candidates.find((c) => c.type.includes("srt")) ??
    candidates.find((c) => c.type.includes("json")) ??
    candidates[0];

  return preferred.url;
}

/** Normalizes a parsed rss-parser output into our shape. */
export function normalizeFeed(
  // rss-parser's Output type is loose; we treat it as data and validate as we go.
  raw: Parser.Output<ItemFields> & FeedFields,
): ParsedFeed {
  const feedArtwork = raw["itunes:image"]?.$?.href ?? raw.image?.url ?? null;

  const episodes: ParsedEpisode[] = [];

  for (const item of raw.items ?? []) {
    const enclosureUrl = item.enclosure?.url ?? null;
    // An item with no audio is not an episode. Feeds legitimately contain these
    // (trailers pointing at a web page, announcements), so skip rather than fail.
    if (!enclosureUrl) continue;

    // guid is required by the RSS spec but frequently absent. The enclosure URL
    // is the next most stable identifier — falling back to title would break
    // dedupe the moment a publisher fixes a typo.
    const guid = item.guid?.trim() || enclosureUrl;

    const enclosureLengthRaw = item.enclosure?.length;
    const enclosureLength =
      enclosureLengthRaw != null ? Number(enclosureLengthRaw) : null;

    episodes.push({
      guid,
      title: item.title?.trim() || "Untitled episode",
      description:
        item["content:encoded"] ??
        item.contentSnippet ??
        item.content ??
        item["itunes:summary"] ??
        null,
      enclosureUrl,
      enclosureType: item.enclosure?.type ?? null,
      enclosureLength:
        enclosureLength != null && Number.isFinite(enclosureLength) && enclosureLength > 0
          ? enclosureLength
          : null,
      durationSeconds: parseDuration(item["itunes:duration"]),
      episodeNumber: parseIntOrNull(item["itunes:episode"]),
      seasonNumber: parseIntOrNull(item["itunes:season"]),
      imageUrl: item["itunes:image"]?.$?.href ?? null,
      publishedAt: parseDate(item.isoDate ?? item.pubDate),
      chaptersUrl: item["podcast:chapters"]?.$?.url ?? null,
      transcriptUrl: extractTranscriptUrl(item.podcastTranscripts),
    });
  }

  return {
    title: raw.title?.trim() || "Untitled podcast",
    author: raw["itunes:author"]?.trim() || raw.managingEditor?.trim() || null,
    description: raw.description?.trim() || null,
    artworkUrl: feedArtwork,
    categories: extractCategories(raw.itunesCategories),
    language: raw.language?.trim() || null,
    link: raw.link?.trim() || null,
    lastBuildDate: parseDate(raw.lastBuildDate),
    episodes,
  };
}

/** Parses feed XML that has already been fetched. Kept separate so it is testable. */
export async function parseFeedXml(xml: string): Promise<ParsedFeed> {
  const raw = (await parser.parseString(xml)) as Parser.Output<ItemFields> & FeedFields;
  return normalizeFeed(raw);
}

/**
 * Fetches and parses a feed, honouring conditional-GET headers.
 *
 * Pass the stored etag/lastModified to get `not-modified` back when nothing has
 * changed — that skips both the download and the parse, which is the single
 * biggest saving when refreshing a few hundred subscriptions.
 */
export async function fetchFeed(
  feedUrl: string,
  conditional?: { etag?: string | null; lastModified?: string | null },
): Promise<FetchFeedResult> {
  let url: URL;
  try {
    url = assertSafeFeedUrl(feedUrl);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof UnsafeUrlError ? err.message : "Invalid feed URL.",
    };
  }

  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
  };
  if (conditional?.etag) headers["if-none-match"] = conditional.etag;
  if (conditional?.lastModified) headers["if-modified-since"] = conditional.lastModified;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      // Manual redirect handling: a permitted public URL must not be able to
      // bounce us into the private network via a 302.
      redirect: "manual",
    });

    if (response.status === 304) {
      return { status: "not-modified" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { status: "error", message: "The feed redirected somewhere invalid." };
      }
      const target = new URL(location, url);
      try {
        assertSafeFeedUrl(target.toString());
      } catch {
        return { status: "error", message: "The feed redirected somewhere invalid." };
      }
      // One hop only — enough for the common http->https and domain-move cases
      // without risking a redirect loop burning the function's time budget.
      const followed = await fetch(target, {
        headers,
        signal: controller.signal,
        redirect: "error",
      });
      return handleResponse(followed);
    }

    return handleResponse(response);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "error", message: "The feed took too long to respond." };
    }
    return { status: "error", message: "Couldn't reach that feed." };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleResponse(response: Response): Promise<FetchFeedResult> {
  if (!response.ok) {
    return {
      status: "error",
      message:
        response.status === 404
          ? "No feed found at that address."
          : `The feed returned an error (${response.status}).`,
    };
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_FEED_BYTES) {
    return { status: "error", message: "That feed is too large to process." };
  }

  const xml = await response.text();
  // content-length is advisory; check the real size too.
  if (xml.length > MAX_FEED_BYTES) {
    return { status: "error", message: "That feed is too large to process." };
  }

  try {
    const feed = await parseFeedXml(xml);
    if (feed.episodes.length === 0 && !feed.title) {
      return { status: "error", message: "That doesn't look like a podcast feed." };
    }
    return {
      status: "ok",
      feed,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  } catch {
    return { status: "error", message: "That feed couldn't be read as RSS." };
  }
}

/**
 * Fetches a Podcasting 2.0 chapters document.
 *
 * Chapters live at a separate URL referenced by <podcast:chapters>, so this is
 * only called when an episode is opened, not during feed ingestion.
 */
export async function fetchChapters(chaptersUrl: string): Promise<Chapter[] | null> {
  try {
    assertSafeFeedUrl(chaptersUrl);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(chaptersUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { chapters?: unknown };
    if (!Array.isArray(data.chapters)) return null;

    const chapters = data.chapters
      .map((c): Chapter | null => {
        if (!c || typeof c !== "object") return null;
        const obj = c as Record<string, unknown>;
        const startTime = Number(obj.startTime);
        if (!Number.isFinite(startTime) || startTime < 0) return null;
        return {
          startTime,
          endTime: Number.isFinite(Number(obj.endTime)) ? Number(obj.endTime) : undefined,
          title: typeof obj.title === "string" ? obj.title : "Chapter",
          url: typeof obj.url === "string" ? obj.url : undefined,
          img: typeof obj.img === "string" ? obj.img : undefined,
        };
      })
      .filter((c): c is Chapter => c !== null)
      .sort((a, b) => a.startTime - b.startTime);

    return chapters.length > 0 ? chapters : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
