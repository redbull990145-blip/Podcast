'use client';

import {
  DEFAULT_PREFERENCES,
  SKIP_BACK_OPTIONS,
  SKIP_FORWARD_OPTIONS,
  type PlaybackPreferences,
} from '@cue/core';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiKeyField } from '@/components/ai/api-key-field';
import { Button } from '@/components/ui/button';
import { useTranslator } from '@/components/i18n/locale-provider';
import { LanguagePicker } from '@/components/i18n/language-picker';
import { SleepTimerChoices, SleepTimerStatus } from '@/components/player/sleep-timer';
import { SpeedScale } from '@/components/player/speed-control';
import { ThemePicker } from '@/components/shell/theme-picker';
import { readPreferences, updatePreferences } from '@/lib/player/store';
import { setNowPlayingTint, useNowPlayingTint } from '@/lib/now-playing-tint';
import { useSession, useSignOut } from '@/lib/session';
import { PageShell } from '@/components/ui/page-shell';

/**
 * Settings.
 *
 * Only what the product actually supports. There are no notification settings
 * because nothing sends them, and no download quality because there is one
 * quality — a settings screen full of switches that do nothing is the fastest
 * way to make an app feel fake.
 *
 * Appearance is the exception that proves it, and it earned its place twice.
 * It went in when the light theme turned out to be reachable only by changing
 * the whole machine's setting, and it grew a second dark scheme when "dark"
 * stopped being one answer. Both times the control followed something the app
 * could already do and had no way to say.
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
    <PageShell>
      <header className="mb-10">
        <h1 className="type-display m-0 text-[var(--color-text-primary)]">{t.t('settings.title')}</h1>
      </header>

      {/* First on the screen, and above Language for the same reason Language
          sits above Account: it changes how everything under it looks, so it
          belongs before the things it changes rather than after them.

          It exists here as well as in the sidebar because the sidebar is not
          on a phone. Settings is the only route to account control at that
          width, and it is now the only route to this. */}
      <Section
        title={t.t('theme.appearance')}
        caption={t.t('theme.appearanceCaption')}
      >
        <Field label={t.t('theme.label')} hint={t.t('theme.hint')}>
          {/* The full set lives here rather than behind the masthead's toggle:
              that control has one axis and there are now two darks, and a
              button that cycles four states is a control you have to press
              repeatedly to find out what it does. */}
          <ThemePicker />
        </Field>

        {/* Under the theme, because it is a modifier on it rather than a
            separate decision: the tint is fitted to whichever scheme is
            selected, so choosing one first is the order the two are actually
            made in. */}
        <Field label={t.t('theme.nowPlayingTint')} hint={t.t('theme.nowPlayingTintHint')}>
          <NowPlayingTintToggle />
        </Field>
      </Section>

      <Section
        title={t.t('settings.playback')}
        caption={t.t('settings.playbackCaption')}
      >
        <Field label={t.t('settings.speed')} hint={t.t('settings.speedHint')}>
          {/* The same control the player has, rather than a second one that
              can disagree with it. A radio group of eight presets could not
              describe a speed set on the slider — someone listening at 1.85
              opened this screen and found nothing selected, which reads as the
              app having lost their preference. */}
          <div className="max-w-[320px]">
            <SpeedScale
              rate={preferences.rate}
              onChange={(rate) => change({ rate })}
            />
          </div>
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

        {/* The same control the player has, for the same reason the speed row
            above is: a second implementation of one setting is a second thing
            that can disagree with the machine. Unlike the rest of this section
            it is not a stored preference — it is a deadline on the running
            player, so it reads as armed here only while it is armed there. */}
        <Field label={t.t('player.sleepTimer')} hint={t.t('settings.sleepTimerHint')}>
          <SleepTimerChoices />
          <SleepTimerStatus className="mt-2.5" />
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
              className="type-callout min-h-11 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-transparent px-5 text-[var(--color-text-primary)] transition-[transform,background-color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-50"
            >
              {signOut.isPending ? t.t('settings.signingOut') : t.t('common.signOut')}
            </button>
          </div>
        ) : (
          /*
            Ink, and the shared button — it was neither.

            This was the one primary action in the product painted in the
            accent, which is the rule DESIGN.md calls "the most consequential in
            the palette": the accent marks *what is playing*, so spending it on
            Sign in puts the one colour that carries information on a control
            that carries none. It was also hand-rolled — a `radius-md` rectangle
            where every other control in the app is a pill — so this screen's
            most important button was the only one shaped like a panel.

            `self-start` is kept: the section is a stretching flex column, and a
            full-bleed Sign in shouts on a screen that is otherwise quiet.
          */
          <Link href={'/signin' as Route} className="self-start no-underline">
            <Button>{t.t('common.signIn')}</Button>
          </Link>
        )}
      </Section>
    </PageShell>
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
 * The one on/off setting in the product, so it is the one switch.
 *
 * `role="switch"` rather than the `role="radio"` pairs everything else on this
 * screen uses, because those are choices between alternatives and this is a
 * single thing being turned on. A two-option radio group would read to a screen
 * reader as "on, 1 of 2" and make the reader hunt for what the other one was.
 *
 * The track carries the state in position *and* fill rather than fill alone, so
 * it survives being looked at by someone who does not separate those two hues —
 * the same two-signal rule the navigation rail follows for its active row.
 */
function NowPlayingTintToggle() {
  const t = useTranslator();
  const enabled = useNowPlayingTint();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={t.t('theme.nowPlayingTint')}
      onClick={() => setNowPlayingTint(!enabled)}
      className={[
        'relative flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border p-0',
        'transition-colors duration-[var(--duration-fast)] ease-standard',
        enabled
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
          : 'border-[var(--color-border-strong)] bg-transparent',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'block h-5 w-5 rounded-full',
          // Travel is a transform, not a margin or an inset: it keeps the knob
          // on the compositor so the toggle cannot cost a layout pass. The
          // settle is the snappy spring pair rather than a plain tween — the
          // knob is a moving object, and the tabulated `linear()` curve gives
          // it the same physics the JS-driven controls use.
          '[transition-timing-function:var(--spring-snappy)] duration-[var(--spring-snappy-duration)] transition-transform',
          enabled
            ? 'translate-x-[22px] bg-[var(--color-text-on-accent)]'
            : 'translate-x-[3px] bg-[var(--color-text-tertiary)]',
        ].join(' ')}
      />
    </button>
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
            className="type-callout min-h-11 min-w-11 cursor-pointer rounded-[var(--radius-md)] border px-4 transition-[transform,background-color,border-color,color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100"
            style={{
              borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
              backgroundColor: active ? 'var(--color-accent-muted)' : undefined,
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
