'use client';

import { queryKeys } from '@cue/api-client';
import type { ListeningStats } from '@cue/types';
import type { Translator } from '@cue/i18n';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * A line under the greeting saying what the greeting is greeting.
 *
 * "Good evening, Etta" is warm and says nothing. What makes a returning
 * listener feel the app kept their place is the app knowing something about
 * them, and the cheapest true version of that is three figures and a name:
 * how much they have listened, how much they finished, and who they have been
 * listening to.
 *
 * Deliberately **one strip, not a dashboard.** The design puts a full analytics
 * panel in Settings — genre bars, a month/year switch, a written summary — and
 * that belongs in Settings. Home is where somebody arrives wanting to press
 * play, and a chart above the resume hero is a page about listening standing in
 * front of the listening.
 *
 * Absent for a new account rather than showing zeroes. "0 hours, 0 shows" is a
 * report card nobody asked for, delivered at the exact moment the product has
 * had no chance to be good yet — see `Recommended`, which handles the same cold
 * start by offering something instead of by measuring nothing.
 */
export function ListeningStats() {
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.stats(),
    queryFn: () => api.getStats(),
    enabled: isSignedIn,
    // Changes only when something has been listened to, and this sits at the
    // top of the most-visited page — a figure that is a few minutes stale is
    // invisible, a request per visit is not.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const t = useTranslator();

  if (!data || data.episodesStarted === 0) return null;

  return (
    <p className="type-callout mt-2.5 mb-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[var(--color-text-secondary)]">
      <Figure>{listenedLabel(data, t)}</Figure>

      {data.episodesFinished > 0 ? (
        <>
          <Separator />
          <Figure>
            {t.t('home.statsFinished', { count: data.episodesFinished })}
          </Figure>
        </>
      ) : null}

      <Separator />
      <Figure>{t.t('home.statsShows', { count: data.showCount })}</Figure>

      {/*
        Who, not just how much.

        The one part of this strip that is about a *thing* rather than a
        quantity, so it is the one part that links somewhere. It is also the
        answer to the question people actually ask themselves — "what have I
        been listening to lately?" — which no amount of hours can give.
      */}
      {data.topShow ? (
        <>
          <Separator />
          <span>
            {t.t('home.statsMostly')}{' '}
            <Link
              href={`/podcast/${data.topShow.id}` as Route}
              className="type-body-strong text-[var(--color-text-primary)] underline-offset-4 hover:underline"
            >
              {data.topShow.title}
            </Link>
          </span>
        </>
      ) : null}
    </p>
  );
}

/**
 * Hours once there are hours, minutes before that.
 *
 * A new listener seeing "0 hr" would be told, accurately and uselessly, that
 * they have done nothing. The translator already switches between `47 min`,
 * `1h 02m` and `2 hr` at the right thresholds, so this is only here to name
 * what the number is.
 */
function listenedLabel(stats: ListeningStats, t: Translator): string {
  return t.t('home.statsListened', {
    duration: t.duration(stats.listenedSec) ?? t.t('format.minutes', { count: 0 }),
  });
}

/** The figure itself, at text weight — the strip is a sentence, not a scoreboard. */
function Figure({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--color-text-primary)]">{children}</span>;
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-[var(--color-text-tertiary)]">
      ·
    </span>
  );
}
