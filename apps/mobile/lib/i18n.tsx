import {
  createTranslator,
  DEFAULT_LOCALE,
  directionOf,
  negotiateLocale,
  type SupportedLocale,
  type Translator,
} from '@cue/i18n';
import * as SecureStore from 'expo-secure-store';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { I18nManager, NativeModules, Platform } from 'react-native';
import { api } from '@/lib/api';

const STORE_KEY = 'cue.locale';

/**
 * The device's own language preference.
 *
 * Read through `Intl` rather than by adding `expo-localization`: Hermes ships
 * full ICU, `resolvedOptions().locale` is exactly the tag we need, and a
 * dependency for one string is a dependency that then has to be kept on the
 * SDK's version treadmill.
 *
 * The Android module is consulted first because `Intl`'s resolved locale is the
 * one it *matched*, which can differ from what the user actually asked for.
 */
function deviceLocales(): string[] {
  const tags: string[] = [];

  if (Platform.OS === 'android') {
    const fromSettings = (NativeModules as { I18nManager?: { localeIdentifier?: string } })
      .I18nManager?.localeIdentifier;
    // `en_GB` on Android, `en-GB` everywhere else.
    if (fromSettings) tags.push(fromSettings.replace('_', '-'));
  }

  try {
    tags.push(new Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // A runtime without Intl data. The default locale is the right fallback.
  }

  return tags;
}

function storedLocale(): string | null {
  try {
    return SecureStore.getItem(STORE_KEY);
  } catch {
    // Keystore unavailable. The device preference still applies.
    return null;
  }
}

export function initialLocale(): SupportedLocale {
  const stored = storedLocale();
  return negotiateLocale(stored ? [stored, ...deviceLocales()] : deviceLocales());
}

type LocaleContext = {
  t: Translator;
  setLocale: (locale: SupportedLocale) => void;
  /**
   * Whether the app has to restart for the layout direction to follow.
   *
   * React Native decides RTL once, at startup — `I18nManager.forceRTL` takes
   * effect on the next launch and there is no supported way to flip a mounted
   * tree. Pretending otherwise would leave Arabic text in a left-to-right
   * layout with no explanation, so this is surfaced and said out loud instead.
   */
  needsRestart: boolean;
};

const Context = createContext<LocaleContext>({
  t: createTranslator(DEFAULT_LOCALE),
  setLocale: () => undefined,
  needsRestart: false,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale);
  const [needsRestart, setNeedsRestart] = useState(false);

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);

    try {
      SecureStore.setItem(STORE_KEY, next);
    } catch {
      // Not persisting is survivable; the session still changes language.
    }

    // Signed in, so the choice follows them to the web app.
    void api.setLocale(next).catch(() => undefined);

    const wantsRtl = directionOf(next) === 'rtl';
    if (wantsRtl !== I18nManager.isRTL) {
      I18nManager.allowRTL(wantsRtl);
      I18nManager.forceRTL(wantsRtl);
      setNeedsRestart(true);
    }
  }, []);

  const value = useMemo<LocaleContext>(
    () => ({ t: createTranslator(locale), setLocale, needsRestart }),
    [locale, setLocale, needsRestart],
  );

  return <Context value={value}>{children}</Context>;
}

export function useLocale(): LocaleContext {
  return use(Context);
}

/** The common case: just the translator. */
export function useTranslator(): Translator {
  return use(Context).t;
}
