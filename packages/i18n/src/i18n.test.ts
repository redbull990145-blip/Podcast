import { describe, expect, it } from 'vitest';
import { formatMessage } from './message.ts';
import {
  baseLanguage,
  directionOf,
  negotiateLocale,
  parseAcceptLanguage,
  SUPPORTED_LOCALES,
} from './locale.ts';
import { createTranslator } from './translator.ts';
import { en, type MessageKey } from './locales/en.ts';
import { es } from './locales/es.ts';
import { hi } from './locales/hi.ts';
import { ar } from './locales/ar.ts';

describe('formatMessage', () => {
  it('interpolates an argument', () => {
    expect(formatMessage('Hello {name}', { name: 'Ada' })).toBe('Hello Ada');
  });

  it('leaves an unsupplied placeholder visible rather than printing undefined', () => {
    // A visible `{name}` is a bug report. The word "undefined" mid-sentence is
    // a mystery.
    expect(formatMessage('Hello {name}')).toBe('Hello {name}');
  });

  it('passes text through when there is nothing to substitute', () => {
    expect(formatMessage('Just words')).toBe('Just words');
  });

  it('substitutes # with the count', () => {
    expect(formatMessage('{n, plural, one {# item} other {# items}}', { n: 4 })).toBe('4 items');
  });

  it('chooses the singular form', () => {
    expect(formatMessage('{n, plural, one {# item} other {# items}}', { n: 1 })).toBe('1 item');
  });

  it('prefers an exact =0 match over the plural category', () => {
    // "No episodes" is usually a different sentence, not a plural of one.
    const message = '{n, plural, =0 {nothing yet} one {# item} other {# items}}';
    expect(formatMessage(message, { n: 0 })).toBe('nothing yet');
    expect(formatMessage(message, { n: 2 })).toBe('2 items');
  });

  it('groups the count for the locale', () => {
    // Spanish uses a dot, and — less obviously — does not group four-digit
    // numbers at all. Both come from CLDR rather than from anything here.
    expect(formatMessage('{n, plural, other {# episodes}}', { n: 10_000 }, 'en')).toBe(
      '10,000 episodes',
    );
    expect(formatMessage('{n, plural, other {# episodios}}', { n: 10_000 }, 'es')).toBe(
      '10.000 episodios',
    );
    expect(formatMessage('{n, plural, other {# episodios}}', { n: 1012 }, 'es')).toBe(
      '1012 episodios',
    );
  });

  it('interpolates other arguments inside a chosen plural body', () => {
    expect(
      formatMessage('{n, plural, other {# from {show}}}', { n: 3, show: 'Cue' }),
    ).toBe('3 from Cue');
  });

  it('handles several placeholders in one message', () => {
    expect(formatMessage('{a} then {b}', { a: 'one', b: 'two' })).toBe('one then two');
  });

  it('accepts a numeric argument as a plain value', () => {
    expect(formatMessage('{count} min', { count: 47 })).toBe('47 min');
  });

  it('degrades to visible text on an unbalanced brace rather than throwing', () => {
    // A broken catalog string should look wrong, not take down the screen.
    expect(() => formatMessage('Hello {name', { name: 'Ada' })).not.toThrow();
    expect(formatMessage('Hello {name', { name: 'Ada' })).toBe('Hello {name');
  });

  it('falls back to `other` when the locale needs a category the catalog omits', () => {
    // 3 selects `few` in Arabic; a catalog that only wrote `other` must still
    // render a sentence rather than an empty string.
    expect(formatMessage('{n, plural, other {# حلقة}}', { n: 3 }, 'ar')).toBe('3 حلقة');
  });

  it('uses the digits the locale asks for', () => {
    // Plain `ar` resolves to Latin digits in current CLDR; Eastern Arabic
    // numerals are a numbering-system extension. Delegating to Intl is what
    // makes both correct without this file knowing either rule.
    expect(formatMessage('{n, plural, other {#}}', { n: 3 }, 'ar-u-nu-arab')).toBe('٣');
  });

  describe('Arabic plural categories', () => {
    // The reason plural selection is delegated to Intl rather than hand-rolled:
    // Arabic has six forms where English has two, and 3 and 11 take different
    // ones of the same noun.
    const message =
      '{n, plural, zero {لا حلقات} one {حلقة واحدة} two {حلقتان} few {# حلقات} many {# حلقة} other {# حلقة}}';

    it.each([
      [0, 'لا حلقات'],
      [1, 'حلقة واحدة'],
      [2, 'حلقتان'],
    ])('selects the right form for %i', (n, expected) => {
      expect(formatMessage(message, { n }, 'ar')).toBe(expected);
    });

    it('uses `few` for 3–10 and `many` for 11–99', () => {
      expect(formatMessage(message, { n: 3 }, 'ar')).toContain('حلقات');
      expect(formatMessage(message, { n: 11 }, 'ar')).not.toContain('حلقات');
    });
  });
});

describe('directionOf', () => {
  it('is rtl for Arabic', () => {
    expect(directionOf('ar')).toBe('rtl');
  });

  it('is rtl for a regional Arabic tag', () => {
    expect(directionOf('ar-EG')).toBe('rtl');
  });

  it.each(['en', 'es', 'hi', 'pt-BR'])('is ltr for %s', (tag) => {
    expect(directionOf(tag)).toBe('ltr');
  });
});

describe('negotiateLocale', () => {
  it('takes an exact match', () => {
    expect(negotiateLocale(['es'])).toBe('es');
  });

  it('matches a regional tag to its base language', () => {
    // We ship no regional variants, so es-MX and es-419 both resolve to es —
    // which is the right answer, and why this matches on the base.
    expect(negotiateLocale(['es-MX'])).toBe('es');
    expect(negotiateLocale(['ar-EG'])).toBe('ar');
  });

  it('walks down the preference list', () => {
    expect(negotiateLocale(['fr', 'de', 'hi'])).toBe('hi');
  });

  it('falls back to English when nothing matches', () => {
    expect(negotiateLocale(['fr', 'de'])).toBe('en');
  });

  it('falls back to English for an empty list', () => {
    expect(negotiateLocale([])).toBe('en');
  });

  it('ignores empty entries', () => {
    expect(negotiateLocale(['', 'hi'])).toBe('hi');
  });

  it('is case-insensitive', () => {
    expect(negotiateLocale(['ES-mx'])).toBe('es');
  });
});

describe('parseAcceptLanguage', () => {
  it('reads a simple header in order', () => {
    expect(parseAcceptLanguage('en-GB,en;q=0.9')).toEqual(['en-GB', 'en']);
  });

  it('sorts by quality rather than by written order', () => {
    // The entire point of q-values. Reading in written order gets this exactly
    // backwards and serves English to someone who asked for Hindi.
    expect(parseAcceptLanguage('en;q=0.2, hi;q=0.9')).toEqual(['hi', 'en']);
  });

  it('drops the wildcard and zero-weighted entries', () => {
    expect(parseAcceptLanguage('*,de;q=0')).toEqual([]);
  });

  it('returns nothing for a missing header', () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });

  it('negotiates from a real header', () => {
    expect(negotiateLocale(parseAcceptLanguage('ar-SA,ar;q=0.9,en;q=0.8'))).toBe('ar');
  });
});

describe('baseLanguage', () => {
  it('strips the region', () => {
    expect(baseLanguage('pt-BR')).toBe('pt');
  });

  it('lowercases', () => {
    expect(baseLanguage('EN-US')).toBe('en');
  });
});

describe('translator', () => {
  it('translates a key', () => {
    expect(createTranslator('es').t('nav.library')).toBe('Biblioteca');
  });

  it('carries the direction with the language', () => {
    expect(createTranslator('ar').direction).toBe('rtl');
    expect(createTranslator('en').direction).toBe('ltr');
  });

  it('formats a duration with the locale’s own words', () => {
    // The bug this replaces: `formatDuration` hardcoded "min" and "hr", so a
    // Hindi UI read "47 min" in the middle of a Devanagari sentence.
    expect(createTranslator('en').duration(2820)).toBe('47 min');
    expect(createTranslator('hi').duration(2820)).toBe('47 मिनट');
  });

  it('renders hours and minutes together', () => {
    expect(createTranslator('en').duration(3720)).toBe('1h 02m');
  });

  it('renders whole hours without the minutes', () => {
    expect(createTranslator('en').duration(7200)).toBe('2 hr');
  });

  it('renders nothing for an unknown duration', () => {
    // Null duration is common and legitimate; `0:00` would be a lie.
    expect(createTranslator('en').duration(null)).toBeNull();
    expect(createTranslator('en').duration(0)).toBeNull();
  });

  it('says Today and Yesterday in the reader’s language', () => {
    const now = new Date();
    expect(createTranslator('es').episodeDate(now.toISOString())).toBe('Hoy');

    const yesterday = new Date(now.getTime() - 86_400_000);
    expect(createTranslator('ar').episodeDate(yesterday.toISOString())).toBe('أمس');
  });

  it('returns an empty string for an unparseable date rather than "Invalid Date"', () => {
    expect(createTranslator('en').episodeDate('not a date')).toBe('');
  });

  it('groups numbers for the locale', () => {
    expect(createTranslator('en').number(10_000)).toBe('10,000');
    expect(createTranslator('es').number(10_000)).toBe('10.000');
  });

  it('uses Indian grouping for Hindi', () => {
    // The clearest evidence that this is real locale data and not a separator
    // swap: Hindi groups by lakh, so the separators do not even fall in the
    // same places.
    expect(createTranslator('hi').number(100_000)).toBe('1,00,000');
    expect(createTranslator('en').number(100_000)).toBe('100,000');
  });

  it('pluralises through the catalog, not through a suffix', () => {
    const t = createTranslator('en').t;
    expect(t('podcast.episodeCount', { count: 1 })).toBe('1 episode');
    expect(t('podcast.episodeCount', { count: 1012 })).toBe('1,012 episodes');
  });
});

describe('catalog completeness', () => {
  const catalogs = { es, hi, ar };
  const keys = Object.keys(en) as MessageKey[];

  it.each(Object.entries(catalogs))('%s translates every key', (_name, catalog) => {
    // The types already enforce this at build time; the runtime check catches a
    // key present but emptied out, which the compiler would accept.
    const missing = keys.filter((key) => !catalog[key]?.trim());
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(catalogs))('%s has no leftover English', (_name, catalog) => {
    // A translation identical to the source is usually a key someone skipped.
    // Proper nouns and shared abbreviations legitimately match, so those are
    // named rather than the check being dropped.
    const shared = new Set<MessageKey>([
      'nav.home',
      'settings.ai',
      'home.emptyBody',
      'settings.apiKey',
      'player.sleepMinutes',
      'format.minutes',
      'format.hours',
      'format.hoursMinutes',
    ]);

    const untranslated = keys.filter(
      (key) => !shared.has(key) && catalog[key] === en[key],
    );

    expect(untranslated).toEqual([]);
  });

  it('every supported locale has a catalog', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(createTranslator(locale).t('nav.library')).toBeTruthy();
    }
  });
});
