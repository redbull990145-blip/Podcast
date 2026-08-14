'use client';

import {
  DEFAULT_PREFERENCES,
  PLAYBACK_RATES,
  SKIP_BACK_OPTIONS,
  SKIP_FORWARD_OPTIONS,
  type PlaybackPreferences,
  type PlaybackRate,
} from '@cue/core';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiKeyField } from '@/components/ai/api-key-field';
import { useTranslator } from '@/components/i18n/locale-provider';
import { LanguagePicker } from '@/components/i18n/language-picker';
import { readPreferences, updatePreferences } from '@/lib/player/store';
import { useSession, useSignOut } from '@/lib/session';

/**
 * Settings.
 *
 * Only what the product actually supports. There is no theme toggle because
 * dark is the design, not a preference; no notification settings because
 * nothing sends them. A settings screen full of switches that do nothing is
 * the fastest way to make an app feel fake.
 */
export function SettingsClient() {
  const t = useTranslator();
  const { user, isSignedIn, isLoading } = useSession();
  const signOut = useSignOut();

  /**
   * Read after mount, not in the initialiser.
   *
   * This page is server-rendered, so a `useState` initialiser runs where there
   * is no `localStorage` and returns defaults — and React keeps that value
   * through hydration rather than re-running it on the client. The result is a
   * settings screen showing 1× while the listener's saved 1.5× sits in storage
   * and drives the player: the controls would be lying about their own state,
   * which is worse than not saving at all.
   */
  const [preferences, setPreferences] = useState<PlaybackPreferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    setPreferences(readPreferences());
  }, []);

  const change = (patch: Partial<PlaybackPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    // Applied to the running player as well as saved, so a change is audible
    // immediately rather than at the next episode.
    updatePreferences(next);
  };

  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-10 md:px-10">
      <header className="mb-10">
        <h1 className="type-display m-0 text-[var(--color-text-primary)]">{t.t('settings.title')}</h1>
      </header>

      <Section
        title={t.t('settings.playback')}
        caption={t.t('settings.playbackCaption')}
      >
        <Field label={t.t('settings.speed')} hint={t.t('settings.speedHint')}>
          <Choices
            options={PLAYBACK_RATES.map((rate) => ({ value: rate, label: `${rate}×` }))}
            selected={preferences.rate}
            onSelect={(rate) => change({ rate: rate as PlaybackRate })}
            name={t.t('settings.speed')}
          />
        </Field>

        <Field label={t.t('settings.skipBack')} hint={t.t('settings.skipBackHint')}>
          <Choices
            options={SKIP_BACK_OPTIONS.map((sec) => ({ value: sec, label: `${sec}s` }))}
            selected={preferences.skipBackSec}
            onSelect={(skipBackSec) => change({ skipBackSec })}
            name={t.t('settings.skipBack')}
          />
        </Field>

        <Field label={t.t('settings.skipForward')} hint={t.t('settings.skipForwardHint')}>
          <Choices
            options={SKIP_FORWARD_OPTIONS.map((sec) => ({ value: sec, label: `${sec}s` }))}
            selected={preferences.skipForwardSec}
            onSelect={(skipForwardSec) => change({ skipForwardSec })}
            name={t.t('settings.skipForward')}
          />
        </Field>
      </Section>

      {/* Above AI and Account because it changes the words those sections are
          written in — a reader who cannot read this screen needs this control
          before anything else on it. */}
      <Section title={t.t('settings.language')} caption={t.t('settings.languageCaption')}>
        <Field label={t.t('settings.language')} hint={t.t('settings.languageHint')}>
          <LanguagePicker />
        </Field>
      </Section>

      {isSignedIn ? (
        <Section title={t.t('settings.ai')} caption={t.t('settings.aiCaption')}>
          <ApiKeyField />
        </Section>
      ) : null}

      <Section title={t.t('settings.account')} caption={t.t('settings.accountCaption')}>
        {isLoading ? null : isSignedIn ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="type-body m-0 text-[var(--color-text-primary)]">
                {user?.name ?? t.t('settings.signedIn')}
              </p>
              <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
                {user?.email}
              </p>
            </div>

            <button
              type="button"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              className="type-callout min-h-11 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-transparent px-5 text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              {signOut.isPending ? t.t('settings.signingOut') : t.t('common.signOut')}
            </button>
          </div>
        ) : (
          <Link
            href={'/signin' as Route}
            // `self-start` because the section is a stretching flex column; a
            // full-bleed Sign in button shouts on a screen that is otherwise
            // quiet.
            className="type-callout inline-flex min-h-11 w-fit items-center self-start rounded-[var(--radius-md)] border-none bg-[var(--color-accent)] px-5 text-[var(--color-text-on-accent)] no-underline"
          >
            {t.t('common.signIn')}
          </Link>
        )}
      </Section>
    </div>
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
  return (
    <section className="mb-12 border-b border-[var(--color-border)] pb-10 last:border-b-0">
      <h2 className="type-title3 mt-0 mb-1 text-[var(--color-text-primary)]">{title}</h2>
      <p className="type-callout mt-0 mb-6 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
        {caption}
      </p>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
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
  return (
    <div>
      <p className="type-body-strong m-0 text-[var(--color-text-primary)]">{label}</p>
      <p className="type-caption mt-0.5 mb-3 text-[var(--color-text-tertiary)]">{hint}</p>
      {children}
    </div>
  );
}

/**
 * A row of mutually exclusive options.
 *
 * A radio group rather than a `<select>`: there are three to eight choices, all
 * of them one or two characters, and putting those behind a dropdown costs a
 * click to see options that fit on one line. `role="radiogroup"` is what keeps
 * it a single arrow-key stop for a keyboard rather than eight tab stops.
 */
function Choices<T extends number>({
  options,
  selected,
  onSelect,
  name,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.value === selected;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(option.value)}
            className="type-callout min-h-11 min-w-11 cursor-pointer rounded-[var(--radius-md)] border px-4 transition-colors"
            style={{
              borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
              backgroundColor: active ? 'var(--color-accent-muted)' : 'transparent',
              color: active ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
