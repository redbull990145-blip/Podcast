/**
 * RSS → domain objects.
 *
 * The governing assumption is that feeds are hostile by accident. Publishers
 * omit required fields, repeat elements that should be unique, wrap text in
 * CDATA, mix RSS and Atom, and put HTML where plain text belongs. So every
 * read here is defensive, and a single broken episode is skipped rather than
 * failing the whole show — losing one episode is recoverable, losing a
 * subscription because episode 400 had no enclosure is not.
 */

import { XMLParser } from 'fast-xml-parser';
import { sanitizeShowNotes } from './sanitize.ts';
import { parseDuration } from './duration.ts';

export type ParsedPodcast = {
  title: string;
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  websiteUrl: string | null;
  language: string | null;
  explicit: boolean;
  categories: string[];
};

export type ParsedEpisode = {
  guid: string;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  audioUrl: string;
  audioType: string | null;
  audioLengthBytes: number | null;
  durationSec: number | null;
  publishedAt: Date;
  artworkUrl: string | null;
  episodeNumber: number | null;
  seasonNumber: number | null;
  explicit: boolean;
  transcriptUrl: string | null;
  transcriptType: string | null;
};

export type ParseResult =
  | { ok: true; podcast: ParsedPodcast; episodes: ParsedEpisode[]; skipped: number }
  | { ok: false; reason: string };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Namespace prefixes are kept: `<itunes:image>` and `<image>` are different
  // elements with different shapes, and collapsing them loses artwork.
  removeNSPrefix: false,
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
  // Feeds contain `&amp;` inside CDATA constantly.
  processEntities: true,
  htmlEntities: true,
});

type XmlNode = Record<string, unknown>;

/** fast-xml-parser gives an object for one child and an array for several. */
function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Read element text whether it arrived bare or as `{ '#text': ... }`. */
function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const node = value as XmlNode;
    if ('#text' in node) return text(node['#text']);
  }
  return null;
}

function attr(node: unknown, name: string): string | null {
  if (!node || typeof node !== 'object') return null;
  return text((node as XmlNode)[`@_${name}`]);
}

/** `<itunes:explicit>` has been `yes`/`no`, `true`/`false`, and `clean`. */
function parseExplicit(value: unknown): boolean {
  const raw = text(value)?.toLowerCase();
  return raw === 'yes' || raw === 'true' || raw === 'explicit';
}

function parseInteger(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Publishers write RFC-822, ISO-8601, and a long tail of near-misses. An
 * unparseable date is fatal for an *episode* because publish order is how the
 * whole app sorts — but the episode is skipped, not the feed.
 */
function parseDate(value: unknown): Date | null {
  const raw = text(value);
  if (raw === null) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  // A feed dated in 1970 or 2140 is a bug; treating it as truth would park the
  // episode at one end of every sorted list forever.
  const year = parsed.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 2) return null;

  return parsed;
}

/** Strip tags for the plain-text summary, keeping the HTML separately. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readArtwork(node: XmlNode): string | null {
  // `<itunes:image href="...">` is the reliable one and is square by spec.
  const itunesImage = node['itunes:image'];
  const href = attr(itunesImage, 'href');
  if (href) return href;

  // RSS `<image><url>...</url></image>` is the older, often-smaller fallback.
  const image = node['image'];
  if (image && typeof image === 'object') {
    const url = text((image as XmlNode)['url']);
    if (url) return url;
  }

  return text(itunesImage);
}

function readCategories(node: XmlNode): string[] {
  const found = new Set<string>();

  for (const category of toArray(node['itunes:category'])) {
    const name = attr(category, 'text');
    if (name) found.add(name);

    // Nested subcategories: <itunes:category text="Society"><itunes:category text="History"/>
    if (category && typeof category === 'object') {
      for (const sub of toArray((category as XmlNode)['itunes:category'])) {
        const subName = attr(sub, 'text');
        if (subName) found.add(subName);
      }
    }
  }

  for (const category of toArray(node['category'])) {
    const name = text(category);
    if (name) found.add(name);
  }

  return [...found].slice(0, 12);
}

function readEpisode(item: XmlNode): ParsedEpisode | null {
  // An episode with no audio is not an episode. This is the one field with no
  // sensible fallback, so it decides whether the item is usable at all.
  const enclosure = toArray(item['enclosure'])[0];
  const audioUrl = attr(enclosure, 'url');
  if (!audioUrl) return null;

  const title = text(item['title']) ?? text(item['itunes:title']);
  if (!title) return null;

  const publishedAt = parseDate(item['pubDate']) ?? parseDate(item['published']);
  if (!publishedAt) return null;

  /**
   * `<guid>` is the stable identity used to dedupe on re-ingest. When it's
   * missing, the audio URL is the best available substitute — it is far more
   * stable than the title, which publishers edit freely.
   */
  const guidNode = item['guid'];
  const guid = text(guidNode) ?? text(item['id']) ?? audioUrl;

  const htmlSource =
    text(item['content:encoded']) ?? text(item['description']) ?? text(item['itunes:summary']);
  const plainSource = text(item['itunes:summary']) ?? text(item['description']);

  const hasMarkup = htmlSource !== null && /<[a-z][\s\S]*>/i.test(htmlSource);

  // `<podcast:transcript>` is how a publisher offers a real transcript — far
  // better than anything we could generate, and free.
  const transcript = toArray(item['podcast:transcript'])[0];

  return {
    guid,
    title,
    description: plainSource ? stripHtml(plainSource) : htmlSource ? stripHtml(htmlSource) : null,
    // Sanitised here, at the boundary, rather than at render: everything
    // downstream is then safe by default instead of safe only if it remembered.
    descriptionHtml: hasMarkup ? sanitizeShowNotes(htmlSource) : null,
    audioUrl,
    audioType: attr(enclosure, 'type'),
    audioLengthBytes: parseInteger(attr(enclosure, 'length')),
    durationSec: parseDuration(text(item['itunes:duration'])),
    publishedAt,
    artworkUrl: readArtwork(item),
    episodeNumber: parseInteger(item['itunes:episode']),
    seasonNumber: parseInteger(item['itunes:season']),
    explicit: parseExplicit(item['itunes:explicit']),
    transcriptUrl: attr(transcript, 'url'),
    transcriptType: attr(transcript, 'type'),
  };
}

export function parseFeed(xml: string): ParseResult {
  let document: XmlNode;
  try {
    document = parser.parse(xml) as XmlNode;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Malformed XML' };
  }

  const rss = document['rss'];
  const channel =
    rss && typeof rss === 'object'
      ? ((rss as XmlNode)['channel'] as XmlNode | undefined)
      : (document['channel'] as XmlNode | undefined);

  if (!channel || typeof channel !== 'object') {
    return { ok: false, reason: 'No <channel> element — not an RSS feed' };
  }

  const title = text(channel['title']);
  if (!title) {
    return { ok: false, reason: 'Feed has no title' };
  }

  const descriptionRaw = text(channel['description']) ?? text(channel['itunes:summary']);

  const podcast: ParsedPodcast = {
    title,
    author: text(channel['itunes:author']) ?? text(channel['managingEditor']),
    description: descriptionRaw ? stripHtml(descriptionRaw) : null,
    artworkUrl: readArtwork(channel),
    websiteUrl: text(channel['link']),
    // `en-US` and `en` both appear; the region is kept, since discovery may
    // want to distinguish pt-BR from pt-PT.
    language: text(channel['language'])?.toLowerCase() ?? null,
    explicit: parseExplicit(channel['itunes:explicit']),
    categories: readCategories(channel),
  };

  const items = toArray(channel['item']);
  const episodes: ParsedEpisode[] = [];
  let skipped = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      skipped += 1;
      continue;
    }

    const episode = readEpisode(item as XmlNode);
    if (episode) {
      episodes.push(episode);
    } else {
      skipped += 1;
    }
  }

  /**
   * Two episodes sharing a guid would collide on the unique index and abort
   * the whole insert. Publishers do ship duplicates, so the first wins — it is
   * the one nearer the top of the feed, which is the newer revision.
   */
  const seen = new Set<string>();
  const deduped = episodes.filter((episode) => {
    if (seen.has(episode.guid)) {
      skipped += 1;
      return false;
    }
    seen.add(episode.guid);
    return true;
  });

  return { ok: true, podcast, episodes: deduped, skipped };
}
