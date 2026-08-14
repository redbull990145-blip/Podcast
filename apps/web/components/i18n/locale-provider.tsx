'use client';

import {
  createTranslator,
  DEFAULT_LOCALE,
  type SupportedLocale,
  type Translator,
} from '@cue/i18n';
import { createContext, use, type ReactNode } from 'react';

/**
 * The translator, for client components.
 *
 * Seeded from the locale the *server* already resolved rather than re-deriving
 * it in the browser. Both halves must agree on the first render — a client that
 * negotiated independently would occasionally disagree with the server and
 * produce a hydration mismatch across every string on the page.
 *
 * `createTranslator` is memoised per locale, so this context holds one shared
 * object rather than rebuilding formatters on each render.
 */
const TranslatorContext = createContext<Translator>(createTranslator(DEFAULT_LOCALE));

export function LocaleProvider({
  locale,
  children,
}: {
  locale: SupportedLocale;
  children: ReactNode;
}) {
  return (
    <TranslatorContext value={createTranslator(locale)}>{children}</TranslatorContext>
  );
}

export function useTranslator(): Translator {
  return use(TranslatorContext);
}
