/**
 * Ranking for the command palette.
 *
 * cmdk ships its own scorer, and this replaces it for one reason: the default
 * is a general-purpose fuzzy matcher tuned for command lists, and half of what
 * this palette contains is podcast titles. Fuzzy subsequence matching over
 * arbitrary prose is where that approach falls apart — "the daily" matched
 * loosely will happily rank *T*ime *to* *H*eal, *E* *D*ay *I*n *L*ife... above
 * an exact-prefix hit on "The Daily", because a subsequence of common letters
 * exists in almost any long title.
 *
 * So the bands below are ordered by how much evidence the match actually
 * carries, and subsequence matching sits at the bottom where it can only ever
 * break a tie between things that have already failed to match properly.
 *
 * Pure and dependency-free so it can be tested directly. cmdk takes it as its
 * `filter` prop, and treats 0 as "hide this row".
 */

/** cmdk's contract: 0 hides the item, higher sorts earlier. */
export const NO_MATCH = 0;

const SCORE = {
  /** The item starts with what was typed. */
  prefix: 1,
  /** A word inside the item starts with what was typed. */
  wordPrefix: 0.85,
  /** It appears somewhere, mid-word. */
  substring: 0.6,
  /** Something in the item's keywords matched, rather than its visible label. */
  keyword: 0.45,
  /** The letters appear in order but not together. Last resort. */
  subsequence: 0.2,
} as const;

/**
 * Lowercase, strip accents, collapse whitespace.
 *
 * Accent folding matters more than it looks: podcast titles are full of them,
 * and someone typing "cafe" on a UK keyboard should still find "Café". The
 * decomposition splits a character into base plus combining mark and the range
 * deletes the marks.
 */
function normalise(value: string): string {
  return value
    .normalize("NFD")
    // U+0300–U+036F is the combining diacritical marks block, written as
    // escapes because the literal characters are invisible in a source file.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every character of `query` appears in `text`, in order. */
function isSubsequence(text: string, query: string): boolean {
  let i = 0;
  for (const char of text) {
    if (char === query[i]) i += 1;
    if (i === query.length) return true;
  }
  return query.length === 0;
}

/**
 * Where a match starts relative to word boundaries.
 *
 * Returns the strongest band the haystack supports, or null for no substring
 * match at all. Word boundaries are spaces and the punctuation that shows up in
 * show titles — hyphens, colons, slashes — so "daily" scores as a word prefix
 * in "The Daily", "Up-Daily" and "News: Daily Edition" alike.
 */
function substringBand(haystack: string, needle: string): number | null {
  const at = haystack.indexOf(needle);
  if (at === -1) return null;
  if (at === 0) return SCORE.prefix;

  const before = haystack[at - 1];
  return /[\s\-–—:/(),.'"]/.test(before) ? SCORE.wordPrefix : SCORE.substring;
}

/**
 * Scores one palette row against the current query.
 *
 * `value` is what cmdk holds for the item and `keywords` are the extra terms it
 * should also be findable by — a route's name alongside its path, a command's
 * synonyms. Keywords deliberately score below any visible-label match so that
 * an item matching on something the user cannot see never outranks one matching
 * on the text in front of them.
 */
export function scoreCommand(
  value: string,
  search: string,
  keywords?: string[],
): number {
  const query = normalise(search);

  // An empty palette shows everything, in the order the groups were declared.
  if (query.length === 0) return SCORE.prefix;

  const haystack = normalise(value);

  const direct = substringBand(haystack, query);
  if (direct !== null) return direct;

  for (const keyword of keywords ?? []) {
    if (normalise(keyword).includes(query)) return SCORE.keyword;
  }

  // Only reached when nothing matched contiguously anywhere. Requiring three
  // characters keeps one- and two-letter queries from matching essentially
  // every row in the list, which is the failure mode that makes a palette feel
  // like it is guessing.
  if (query.length >= 3 && isSubsequence(haystack, query)) {
    return SCORE.subsequence;
  }

  return NO_MATCH;
}
