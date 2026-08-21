import { LOCALE_NAMES, SUPPORTED_LOCALES, type SupportedLocale } from '@cue/i18n';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocale } from '@/lib/i18n';
import { radius, space, type, useTheme } from '@/theme';

/**
 * Choosing the interface language.
 *
 * The words change immediately; the **layout direction does not**. React Native
 * decides right-to-left once at startup — `I18nManager.forceRTL` applies on the
 * next launch and there is no supported way to mirror a mounted tree. So
 * switching to Arabic translates everything and then says, plainly, that the
 * layout follows after a restart.
 *
 * Saying it is the whole point. Arabic text in a left-to-right layout with no
 * explanation reads as a broken translation rather than as a pending one, and
 * the reader has no way to know a restart would fix it.
 */
export function LanguagePicker() {
  const theme = useTheme();
  const { t, setLocale, needsRestart } = useLocale();

  return (
    <View>
      <View style={styles.row}>
        {SUPPORTED_LOCALES.map((locale) => {
          const active = locale === t.locale;

          return (
            <Pressable
              key={locale}
              onPress={() => setLocale(locale as SupportedLocale)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={LOCALE_NAMES[locale]}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active
                    ? theme.accentMuted
                    : pressed
                      ? theme.surfaceHover
                      : 'transparent',
                  borderColor: active ? theme.accent : theme.border,
                },
              ]}
            >
              <Text
                style={[
                  type('callout'),
                  { color: active ? theme.accentText : theme.textSecondary },
                ]}
              >
                {LOCALE_NAMES[locale]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {needsRestart ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[type('caption'), { color: theme.accentText, marginTop: space[3] }]}
        >
          {t.t('settings.restartForDirection')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: 44,
    paddingHorizontal: space[4],
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
