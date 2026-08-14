/**
 * Which language to speak, and which way the words run.
 */

/**
 * The languages the UI is translated into.
 *
 * Deliberately short. Each one is a catalog somebody has to keep correct as
 * the product changes, and four maintained languages are worth more than
 * twenty that drift into half-English within a release. Arabic is here partly
 * for its own sake and partly because right-to-left is the layout constraint
 * that catches every hardcoded `margin-left` in the codebase.
 */
export const SUPPORTED_LOCALES = ['en', 'es', 'hi', 'ar'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** Endonyms — a language picker written in the reader's own language. */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  hi: 'हिन्दी',
  ar: 'العربية',
};

/**
 * Scripts written right to left.
 *
 * A list rather than a lookup on `Intl.Locale`, whose `textInfo` is still not
 * available everywhere this ships — notably Hermes. The set of RTL scripts is
 * small and does not change.
 */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv', 'ckb']);

export type Direction = 'ltr' | 'rtl';

export function directionOf(locale: string): Direction {
  return RTL_LANGUAGES.has(baseLanguage(locale)) ? 'rtl' : 'ltr';
}

/** `pt-BR` → `pt`. Case-normalised, since headers and device settings vary. */
export function baseLanguage(tag: string): string {
  return (tag.split('-')[0] ?? '').toLowerCase();
}

/**
 * Pick the best supported locale for a list of preferences.
 *
 * Exact match wins over base-language match: someone asking for `pt-BR` should
 * get `pt-BR` if we had it, and `pt` only as a fallback. We currently ship no
 * regional variants, so in practice this resolves `es-MX` and `es-419` alike
 * to `es` — which is the right answer, and the reason to match on the base
 * rather than demanding an exact tag.
 */
export function negotiateLocale(
  preferences: readonly string[],
  supported: readonly string[] = SUPPORTED_LOCALES,
): SupportedLocale {
  for (const preference of preferences) {
    if (!preference) continue;

    const wanted = preference.toLowerCase();

    const exact = supported.find((candidate) => candidate.toLowerCase() === wanted);
    if (exact) return exact as SupportedLocale;

    const base = baseLanguage(preference);
    const partial = supported.find((candidate) => baseLanguage(candidate) === base);
    if (partial) return partial as SupportedLocale;
  }

  return DEFAULT_LOCALE;
}

/**
 * Parse an `Accept-Language` header into preferences, best first.
 *
 * Quality values are honoured because they are the entire point of the header:
 * `en;q=0.2, hi;q=0.9` means "Hindi, but English will do", and reading it in
 * written order gets that exactly backwards.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];

  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param))
        .find(Boolean)?.[1];

      return { tag: (tag ?? '').trim(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && Number.isFinite(entry.q) && entry.q > 0)
    // Stable within equal weights, so written order still breaks ties.
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}
