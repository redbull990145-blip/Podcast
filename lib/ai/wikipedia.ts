/**
 * Short reference notes from Wikipedia, for questions about who someone is.
 *
 * Chosen over a search API because it needs no key, no account and no billing
 * relationship, and because it answers exactly the question the assistant has
 * to reach outside the episode for. It is not a search engine and is not meant
 * to become one — see people.ts for what limits when this is called at all.
 *
 * Every failure here is silent by design. A reference note improves an answer;
 * it is never the thing being asked for, so a slow or unreachable Wikipedia
 * must cost the listener nothing but the note itself.
 */

const SEARCH_URL = "https://en.wikipedia.org/w/rest.php/v1/search/page";
const SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/";

/** Wikimedia asks callers to identify themselves and will throttle those who don't. */
const USER_AGENT = "Cadence-Podcast-App/1.0 (https://github.com/redbull990145-blip/Podcast)";

/** Short, because this rides in front of a whole transcript. */
const MAX_EXTRACT_CHARS = 600;

/** The whole lookup is worth about this much of a request that takes ten seconds. */
const LOOKUP_TIMEOUT_MS = 3_500;

export type ReferenceNote = {
  /** The name as asked about, so the model can match it to the question. */
  name: string;
  /** The article's own title, which may differ — redirects, disambiguation. */
  title: string;
  extract: string;
};

/**
 * Whether an article is actually about the person who was searched for.
 *
 * Wikipedia search always returns its best guess, and its best guess for
 * someone with no article of their own is whatever they are associated with:
 * "Ranjit Bajaj" comes back as "Minerva Academy FC", the club he founded. Fed
 * to the model unchecked, that note answers "who is Ranjit Bajaj" with the
 * description of a football club — a confident, sourced, completely wrong
 * biography, which is the exact failure the lookup was added to prevent.
 *
 * So the article has to say the name. Every meaningful word of it, in the title
 * or in the opening summary, where an article about a person always states who
 * they are. No match means no article about them exists, and no note is better
 * than a note about something else.
 */
export function isAboutPerson(name: string, title: string, extract: string): boolean {
  const haystack = `${title} ${extract}`.toLowerCase();
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);

  return words.length > 0 && words.every((word) => haystack.includes(word));
}

type CacheEntry = { note: ReferenceNote | null; at: number };

/**
 * Process-local and deliberately simple. Biographies do not move, the same
 * host is asked about repeatedly within a session, and a cache that dies with
 * the process is the right size for something with no correctness role.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getJson(url: string, signal: AbortSignal): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal,
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function lookupOne(name: string, signal: AbortSignal): Promise<ReferenceNote | null> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.note;

  // Search first rather than guessing the article path: "Ranjit Bajaj" is not
  // reliably the title of the page about him, and a 404 teaches us nothing.
  const search = (await getJson(
    `${SEARCH_URL}?q=${encodeURIComponent(name)}&limit=1`,
    signal,
  )) as { pages?: { key?: string; title?: string }[] } | null;

  const page = search?.pages?.[0];
  let note: ReferenceNote | null = null;

  if (page?.key) {
    const summary = (await getJson(
      `${SUMMARY_URL}${encodeURIComponent(page.key)}`,
      signal,
    )) as { extract?: string; title?: string; type?: string } | null;

    const extract = summary?.extract?.trim();
    const title = summary?.title ?? page.title ?? name;
    // A disambiguation page lists articles rather than describing anything, so
    // it is worse than no note: it reads as facts about the person.
    if (
      extract &&
      summary?.type !== "disambiguation" &&
      isAboutPerson(name, title, extract)
    ) {
      note = {
        name,
        title,
        extract:
          extract.length > MAX_EXTRACT_CHARS
            ? `${extract.slice(0, MAX_EXTRACT_CHARS)}…`
            : extract,
      };
    }
  }

  // Misses are cached too — a name with no article will have no article next
  // time either, and re-asking costs the listener latency for nothing.
  cache.set(name, { note, at: Date.now() });
  return note;
}

/** Looks up several names at once, dropping any that can't be found in time. */
export async function referenceNotes(names: string[]): Promise<ReferenceNote[]> {
  if (names.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    // Capped: a question naming five people should not cost five round trips
    // in front of the answer.
    const settled = await Promise.all(
      names.slice(0, 3).map((name) => lookupOne(name, controller.signal)),
    );
    return settled.filter((note): note is ReferenceNote => note !== null);
  } finally {
    clearTimeout(timeout);
  }
}
