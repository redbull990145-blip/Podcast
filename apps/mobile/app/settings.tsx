import {
  PLAYBACK_RATES,
  SKIP_BACK_OPTIONS,
  SKIP_FORWARD_OPTIONS,
  type PlaybackPreferences,
  type PlaybackRate,
} from '@cue/core';
import { icon } from '@cue/design';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiKeyField } from '@/components/api-key-field';
import { Button } from '@/components/button';
import { LanguagePicker } from '@/components/language-picker';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { readPreferences, updatePreferences } from '@/lib/player/store';
import { useTranslator } from '@/lib/i18n';
import { useSession, useSignOut } from '@/lib/session';
import { radius, space, type, useTheme } from '@/theme';

/**
 * Settings.
 *
 * Only what the product actually supports. There is no theme toggle because
 * dark is the design, not a preference; no notification settings because
 * nothing sends them. A settings screen full of switches that do nothing is
 * the fastest way to make an app feel fake.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useTranslator();
  const { user, isSignedIn, isLoading } = useSession();
  const signOut = useSignOut();

  // Read once, on mount. Device-local state that only this screen edits, so
  // there is nothing to subscribe to.
  const [preferences, setPreferences] = useState<PlaybackPreferences>(() => readPreferences());

  const change = (patch: Partial<PlaybackPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    // Applied to the running player as well as saved, so a change is audible
    // immediately rather than at the next episode.
    updatePreferences(next);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t.t('nav.settings')}
          hitSlop={space[3]}
          scale={0.9}
          style={styles.dismiss}
        >
          <Icon path={icon.chevronDown} size={26} color={theme.textSecondary} />
        </PressableScale>

        <Text style={[type('title2'), { color: theme.textPrimary }]}>{t.t('settings.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space[5],
          paddingBottom: insets.bottom + space[10],
        }}
      >
        <Section
          title={t.t('settings.playback')}
          caption={t.t('settings.playbackCaption')}
        >
          <Field label={t.t('settings.speed')} hint={t.t('settings.speedHint')}>
            <Choices
              name={t.t('settings.speed')}
              options={PLAYBACK_RATES.map((rate) => ({ value: rate, label: `${rate}×` }))}
              selected={preferences.rate}
              onSelect={(rate) => change({ rate: rate as PlaybackRate })}
            />
          </Field>

          <Field label={t.t('settings.skipBack')} hint={t.t('settings.skipBackHint')}>
            <Choices
              name={t.t('settings.skipBack')}
              options={SKIP_BACK_OPTIONS.map((sec) => ({ value: sec, label: `${sec}s` }))}
              selected={preferences.skipBackSec}
              onSelect={(skipBackSec) => change({ skipBackSec })}
            />
          </Field>

          <Field label={t.t('settings.skipForward')} hint={t.t('settings.skipForwardHint')}>
            <Choices
              name={t.t('settings.skipForward')}
              options={SKIP_FORWARD_OPTIONS.map((sec) => ({ value: sec, label: `${sec}s` }))}
              selected={preferences.skipForwardSec}
              onSelect={(skipForwardSec) => change({ skipForwardSec })}
            />
          </Field>
        </Section>

        <Section
          title={t.t('settings.language')}
          caption={t.t('settings.languageCaption')}
        >
          <Field label={t.t('settings.language')} hint={t.t('settings.languageHint')}>
            <LanguagePicker />
          </Field>
        </Section>

        {isSignedIn ? (
          <Section
            title={t.t('settings.ai')}
            caption={t.t('settings.aiCaption')}
          >
            <ApiKeyField />
          </Section>
        ) : null}

        <Section
          title={t.t('settings.account')}
          caption={t.t('settings.accountCaption')}
        >
          {isLoading ? null : isSignedIn ? (
            <View style={styles.account}>
              <Text style={[type('body'), { color: theme.textPrimary }]}>
                {user?.name ?? t.t('settings.signedIn')}
              </Text>
              {user?.email ? (
                <Text style={[type('caption'), { color: theme.textTertiary, marginTop: 2 }]}>
                  {user.email}
                </Text>
              ) : null}

              <Button
                label={signOut.isPending ? t.t('settings.signingOut') : t.t('common.signOut')}
                variant="secondary"
                disabled={signOut.isPending}
                onPress={() => signOut.mutate()}
                style={styles.accountButton}
              />
            </View>
          ) : (
            <Button
              label={t.t('common.signIn')}
              onPress={() => router.push('/signin')}
              style={styles.accountButton}
            />
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.section, { borderBottomColor: theme.border }]}>
      <Text style={[type('title3'), { color: theme.textPrimary }]}>{title}</Text>
      <Text style={[type('caption'), { color: theme.textSecondary, marginTop: space[1] }]}>
        {caption}
      </Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <View>
      <Text style={[type('bodyStrong'), { color: theme.textPrimary }]}>{label}</Text>
      <Text
        style={[type('caption'), { color: theme.textTertiary, marginTop: 2, marginBottom: space[3] }]}
      >
        {hint}
      </Text>
      {children}
    </View>
  );
}

/**
 * A row of mutually exclusive options.
 *
 * `radio` rather than `button`, so a screen reader announces both the choice
 * and which one is taken — a row of eight buttons where one happens to be
 * tinted says nothing at all without sight.
 */
function Choices<T extends number>({
  name,
  options,
  selected,
  onSelect,
}: {
  name: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const theme = useTheme();

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={name} style={styles.choices}>
      {options.map((option) => {
        const active = option.value === selected;

        return (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            style={[
              styles.choice,
              {
                borderColor: active ? theme.accent : theme.border,
                backgroundColor: active ? theme.accentMuted : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                type('callout'),
                { color: active ? theme.accentText : theme.textSecondary },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[4],
  },
  dismiss: { padding: space[1] },
  section: {
    paddingVertical: space[6],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionBody: { marginTop: space[5], gap: space[6] },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  choice: {
    minHeight: 44,
    minWidth: 52,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  account: { gap: 0 },
  accountButton: { marginTop: space[4], alignSelf: 'flex-start' },
});
