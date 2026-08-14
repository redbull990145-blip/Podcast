import 'server-only';

import {
  createTranslator,
  negotiateLocale,
  parseAcceptLanguage,
  type SupportedLocale,
  type Translator,
} from '@cue/i18n';
import { cookies, headers } from 'next/headers';

/**
 * Resolving the reader's language on the server.
 *
 * Done here rather than in the browser so the first paint is already in the
 * right language and the right direction. Deciding client-side would mean
 * rendering English, hydrating, then swapping — which on an RTL locale is not
 * a flash of the wrong words but a flash of the entire layout mirrored.
 *
 * Order: an explicit choice, then the browser's own preference. Someone who has
 * picked Hindi in Settings gets Hindi on a borrowed laptop whose browser asks
 * for English, which is the whole point of the setting.
 */
export const LOCALE_COOKIE = 'cue.locale';

export async function resolveLocale(): Promise<SupportedLocale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const chosen = cookieStore.get(LOCALE_COOKIE)?.value;
  const accepted = parseAcceptLanguage(headerList.get('accept-language'));

  return negotiateLocale(chosen ? [chosen, ...accepted] : accepted);
}

/** The server-side translator, for pages and layouts. */
export async function getTranslator(): Promise<Translator> {
  return createTranslator(await resolveLocale());
}
