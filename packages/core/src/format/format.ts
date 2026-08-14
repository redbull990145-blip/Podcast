/**
 * Display formatting that involves no words.
 *
 * `formatDuration`, `formatEpisodeDate` and `formatCount` used to live here.
 * They took a `locale` argument and then hardcoded English anyway — "min",
 * "hr", "Today", and a plural formed by appending an `s`. That is worse than
 * having no localisation at all: `formatCount(1012, 'episode', 'hi')` produced
 * Hindi-grouped digits followed by an English word, and no language on earth
 * pluralises by suffixing "s" to a noun borrowed from another one.
 *
 * They now live on the translator in `@cue/i18n`, where the words come from a
 * catalog and the plural category comes from `Intl.PluralRules`. What is left
 * here is the formatting that is genuinely language-independent.
 */

/** `0:42`, `12:07`, `1:03:20` — for a scrubber, where digits must not jump. */
export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  const paddedSecs = String(secs).padStart(2, '0');
  if (hours === 0) return `${minutes}:${paddedSecs}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSecs}`;
}
