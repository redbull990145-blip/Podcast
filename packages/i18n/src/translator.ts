/**
 * The translator: one object carrying everything that depends on locale.
 *
 * Deliberately not just a `t()` function. Dates, durations and grouped numbers
 * are as locale-dependent as the words around them, and splitting them apart is
 * how an app ends up with Hindi prose next to `12 Aug` and `1,012` — correct
 * English formatting embedded in a sentence nobody reading it can parse.
 *
 * Formatting that involves *no words at all* stays in `@cue/core`:
 * `formatTimestamp` produces `4:07`, which is the same in every language this
 * ships in, and routing it through here would be ceremony.
 */

import { formatMessage, type MessageValues } from './message.ts';
import {
  DEFAULT_LOCALE,
  directionOf,
  type Direction,
  type SupportedLocale,
} from './locale.ts';
import { en, type Catalog, type MessageKey } from './locales/en.ts';
import { es } from './locales/es.ts';
import { hi } from './locales/hi.ts';
import { ar } from './locales/ar.ts';

const CATALOGS: Record<SupportedLocale, Catalog> = { en, es, hi, ar };

export type Translator = {
  locale: SupportedLocale;
  direction: Direction;

  /** Look up and format a message. */
  t: (key: MessageKey, values?: MessageValues) => string;

  /** `47 min`, `1h 02m`. Null duration renders as nothing, never `0:00`. */
  duration: (seconds: number | null) => string | null;

  /** `Today`, `Yesterday`, `Tue`, `12 Aug`, `12 Aug 2024`. */
  episodeDate: (iso: string) => string;

  /** Grouped for the locale — `1,012` in English, `1.012` in Spanish. */
  number: (value: number) => string;
};

const cache = new Map<SupportedLocale, Translator>();

export function createTranslator(locale: SupportedLocale = DEFAULT_LOCALE): Translator {
  const existing = cache.get(locale);
  if (existing) return existing;

  const catalog = CATALOGS[locale] ?? en;

  const t = (key: MessageKey, values?: MessageValues): string => {
    /**
     * Fall back to English rather than showing the key.
     *
     * The types make a missing key a compile error, so this only fires if a
     * catalog is edited into an empty string. Even then, an English sentence
     * is a far better failure than `library.emptyBody` on screen.
     */
    const template = catalog[key] || en[key];
    return formatMessage(template, values, locale);
  };

  const numberFormat = new Intl.NumberFormat(locale);

  const translator: Translator = {
    locale,
    direction: directionOf(locale),
    t,

    duration: (seconds) => {
      if (seconds === null || seconds <= 0) return null;

      const totalMinutes = Math.round(seconds / 60);
      if (totalMinutes < 60) return t('format.minutes', { count: totalMinutes });

      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      return minutes === 0
        ? t('format.hours', { count: hours })
        : t('format.hoursMinutes', { hours, minutes: String(minutes).padStart(2, '0') });
    },

    episodeDate: (iso) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';

      const now = new Date();
      const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);

      // Recency is what a listener wants from an episode date — "is this new?"
      // — so the format tightens as the episode ages.
      if (days <= 0) return t('format.today');
      if (days === 1) return t('format.yesterday');
      if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);

      const sameYear = date.getFullYear() === now.getFullYear();
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
      }).format(date);
    },

    number: (value) => numberFormat.format(value),
  };

  cache.set(locale, translator);
  return translator;
}

export type { MessageKey };
