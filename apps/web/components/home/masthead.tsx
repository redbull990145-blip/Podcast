'use client';

import { useEffect, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { HomeSearch } from '@/components/home/home-search';
import { ListeningStats } from '@/components/home/listening-stats';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { useSession } from '@/lib/session';

/**
 * The top of Home.
 *
 * Two states, and which one you get is the difference between arriving and
 * returning.
 *
 * **A stranger gets the proposition.** "Listen", and a sentence saying the
 * audio comes from the publishers themselves and nothing is asked of them
 * before they press play. Those are the two facts that decide whether someone
 * stays, and there is no point greeting a person the app has never met.
 *
 * **Someone signed in gets the date and their name.** They already know what
 * Cue is; what a returning listener wants at the top of the page is the sense
 * that it kept their place, and the greeting is the cheapest possible version
 * of that. The lede goes with it — keeping a pitch above the resume hero for
 * someone who has been using the app for a month is the app talking to itself.
 *
 * Client-rendered, which is a trade rather than an oversight. Home is cached
 * for five minutes and shared by everyone, so a greeting cannot come from the
 * server without either making the page per-request or handing one listener's
 * name to the next. The date has the same problem for a duller reason: it is
 * the *reader's* date, and a server in another timezone will confidently
 * render yesterday. So the first paint is the signed-out masthead — which is
 * also the correct one for most first visits — and it settles once when the
 * session resolves, in the same beat as the resume hero below it.
 */
export function Masthead() {
  const t = useTranslator();
  const { user } = useSession();

  /*
    Read after mount, never during render: the server and the client are in
    different timezones often enough that rendering a date in both places is a
    hydration mismatch waiting for a traveller.
  */
  const [today, setToday] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);

  useEffect(() => {
    const now = new Date();
    setHour(now.getHours());
    setToday(
      new Intl.DateTimeFormat(t.locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(now),
    );
  }, [t.locale]);

  const name = user?.name?.trim();
  const greeting = name && hour !== null ? t.t(greetingKey(hour), { name }) : null;

  return (
    <header className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
      <div className="min-w-0">
        {/* The overline holds its line whether or not the date has landed, so
            the title does not jump down a row on hydration. */}
        <p className="type-overline m-0 min-h-[14px] text-[var(--color-text-tertiary)]">
          {today}
        </p>

        <h1 className="type-display mt-1.5 mb-0 text-[var(--color-text-primary)]">
          {greeting ?? t.t('home.title')}
        </h1>

        {/*
          A stranger gets the pitch; someone signed in gets their own figures.

          Both occupy the same slot under the title, and only one of them can
          be true at a time: a returning listener does not need to be told what
          Cue is, and a first-time visitor has no listening to report. The
          stats strip decides for itself whether it has anything worth saying,
          so a brand-new account falls through to nothing rather than to a row
          of zeroes.
        */}
        {greeting ? (
          <ListeningStats />
        ) : (
          <p className="type-body mt-2 mb-0 max-w-[52ch] text-[var(--color-text-secondary)]">
            {t.t('home.lede')}
          </p>
        )}
      </div>

      {/* Beside the title once there is room for it, rather than under it.
          Search is the way in to the rest of the product, not a feature of this
          page — and a full-width field stretched under a two-line paragraph
          read as the page's primary action, which it is not. Below `lg` it
          drops back under the lede, where a phone has nowhere else to put it. */}
      <div className="flex w-full shrink-0 items-center gap-3 lg:mt-1 lg:w-auto">
        <div className="min-w-0 flex-1 lg:w-[300px] lg:flex-none">
          <HomeSearch />
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

/**
 * Morning until noon, afternoon until six, evening after.
 *
 * Deliberately three coarse buckets rather than anything cleverer. "Good
 * night" at 1am is the kind of detail that reads as a bug the one time it is
 * wrong, and nobody has ever noticed the app not saying it.
 */
function greetingKey(hour: number) {
  if (hour < 12) return 'home.morning' as const;
  if (hour < 18) return 'home.afternoon' as const;
  return 'home.evening' as const;
}
