'use client';

import { LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from '@cue/i18n';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { api } from '@/lib/api';

/**
 * Choosing the interface language.
 *
 * Written to a cookie rather than to React state, because the language is
 * resolved on the *server* — `<html lang>` and `dir` are server-rendered, and a
 * client-only switch would leave the document claiming one language while
 * showing another. So the choice is stored, then the route is refreshed, and
 * the server re-renders everything in the new language and direction at once.
 *
 * `router.refresh()` rather than a full reload: it re-runs the server
 * components without discarding the query cache or interrupting playback, which
 * a reload would.
 */
export function LanguagePicker() {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState<SupportedLocale>(t.locale);

  const choose = (locale: SupportedLocale) => {
    if (locale === current) return;
    setCurrent(locale);

    /**
     * A year, and site-wide.
     *
     * `SameSite=Lax` so it survives following a shared link into the app —
     * `Strict` would drop it on exactly the navigation where a reader most
     * needs the app to already be in their language.
     */
    document.cookie = `cue.locale=${locale}; path=/; max-age=31536000; samesite=lax`;

    // Signed in, so it follows them to their phone. Failure is not worth
    // interrupting the change for — the cookie already applied it here.
    void api.setLocale(locale).catch(() => undefined);

    startTransition(() => router.refresh());
  };

  return (
    <div
      role="radiogroup"
      aria-label={t.t('settings.language')}
      aria-busy={pending || undefined}
      className="flex flex-wrap gap-2"
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const active = locale === current;

        return (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={active}
            /**
             * The label is in its own language, and so is the element.
             * `lang` and `dir` here are what stop "العربية" from being laid
             * out left-to-right inside an English page — the one place in the
             * app where a string's direction differs from the document's.
             */
            lang={locale}
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            onClick={() => choose(locale)}
            className="type-callout min-h-11 cursor-pointer rounded-[var(--radius-md)] border px-4 transition-[transform,background-color,border-color,color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100"
            style={{
              backgroundColor: active ? 'var(--color-accent-muted)' : undefined,
              borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
              color: active ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
            }}
          >
            {LOCALE_NAMES[locale]}
          </button>
        );
      })}
    </div>
  );
}
