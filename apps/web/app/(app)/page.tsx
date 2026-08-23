import type { Podcast } from '@cue/types';
import type { Translator } from '@cue/i18n';
import type { Route } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ContinueListening } from '@/components/home/continue-listening';
import { Masthead } from '@/components/home/masthead';
import {
  LatestEpisodes,
  LatestEpisodesSkeleton,
} from '@/components/home/latest-episodes';
import { RecentlyPlayed } from '@/components/home/recently-played';
import { Recommended } from '@/components/home/recommended';
import { catalogue, ApiClientError } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';

/**
 * Home.
 *
 * Rendered on the server so the first paint carries real content rather than
 * a skeleton that resolves a moment later — the fastest loading state is the
 * one that never appears.
 *
 * The render itself is per-request — see the note above `HomePage` — but the
 * catalogue read behind it is cached for five minutes. Podcast metadata changes
 * when a publisher edits it, which is rarely, so reusing a recent response and
 * refreshing it in the background is both faster and cheaper than querying on
 * every visit.
 *
 * The page answers four questions, in the order people actually ask them:
 *
 *  1. *Where was I?* — Continue listening, for anyone with something running.
 *  2. *What should I start?* — three recommendations, each saying why it is
 *     there.
 *  3. *What just landed?* — the newest episode from each active show.
 *  4. *What was that thing I heard?* — recently played.
 *
 * It used to end with the whole catalogue in a five-column grid, under a
 * heading, followed by a panel pointing at search. Both are gone. A catalogue
 * is a *browsing* surface and browsing is what Search is: putting the same grid
 * on Home meant the page's largest and least considered section was the one
 * that had already been done better one click away, and it pushed the sections
 * that are actually about this listener above the fold only on a tall window.
 *
 * The order is forward-looking first and backward-looking last, which is also
 * why the rule above Recently played is the only one on the page: it is where
 * Home stops offering and starts recording.
 */
/*
  No `export const revalidate` here, deliberately.

  These pages carried one — 300 seconds — and it never took effect. Route-level
  revalidation needs a route Next can render without a request, and every route
  in this app is dynamic because app/layout.tsx reads the CSP nonce off a
  request header (and `resolveLocale()` reads cookies). Both are per-request by
  definition, so the segment config was inert and the page re-fetched the
  catalogue on every single visit.

  The 300 seconds now lives on the `catalogue` client in lib/api.ts, which
  caches at the fetch layer instead. That layer is not affected by the route
  being dynamic, so the caching the number always described actually happens.
*/

export default async function HomePage() {
  const t = await getTranslator();

  let podcasts: Podcast[] = [];
  let failure: string | null = null;

  try {
    // Feeds two sections now that the catalogue grid is gone: Latest episodes
    // reads a newest episode per show, and the recommendation fallback takes
    // the front of it for anyone the ranker cannot speak to yet.
    const page = await catalogue.getPodcasts({ limit: 18 });
    podcasts = page.items;
  } catch (error) {
    // The API being down is a state to render, not a crash. A blank screen
    // with no explanation is the worst possible version of this.
    failure =
      error instanceof ApiClientError ? error.message : t.t('common.unreachable');
  }

  const hasCatalogue = podcasts.length > 0;

  return (
    <div className="mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <Masthead />

      {/*
        Client-rendered while the page around it is static. What is in progress
        is per-listener and changes by the minute, so it cannot share the page's
        5-minute cache — and it must not stop the rest of Home from being served
        instantly to everyone.
      */}
      <ContinueListening />

      {failure ? <ErrorState t={t} message={failure} /> : null}
      {!failure && !hasCatalogue ? <EmptyState t={t} /> : null}

      {hasCatalogue ? (
        <>
          {/*
            Three shows, chosen and captioned.

            Server-rendered covers go in as the fallback rather than being
            rendered here: personalisation is per-listener and this page is
            cached for everybody, so the ordering has to be decided on the
            client. Passing the list down means the section is full on first
            paint either way, and a signed-out reader gets the front of the
            catalogue under an honest label instead of a hole.
          */}
          <Recommended fallback={podcasts} />

          {/*
            Streamed. The episodes behind this section come from one request
            per show, so making the whole page wait on them would trade a fast
            first paint for a slightly fuller one. The fallback claims the space
            so nothing below moves when they land.
          */}
          <Suspense fallback={<LatestEpisodesSkeleton />}>
            <LatestEpisodes podcasts={podcasts} />
          </Suspense>

          {/*
            Where the page turns around.

            Everything above is forward-looking — finish this, start that,
            here is what just landed. This is the record, and it is last
            because looking something up is a thing you arrive intending to do,
            not something you need offered.
          */}
          <RecentlyPlayed />
        </>
      ) : null}
    </div>
  );
}

/**
 * An empty catalogue.
 *
 * The old copy told the reader to run `npm run seed -w @cue/api`, which is an
 * instruction for whoever is building the app and gibberish to everyone else —
 * and it was translated into four languages, so a visitor in Cairo got a shell
 * command in Arabic. The user-facing state now points at the one thing that
 * actually works when the catalogue is empty, which is search; the developer
 * hint survives as a development-only note, in English, where it belongs.
 */
function EmptyState({ t }: { t: Translator }) {
  return (
    <Notice
      title={t.t('home.empty')}
      body={t.t('home.emptyBody')}
      action={{ href: '/search', label: t.t('search.title') }}
    >
      <DevHint>
        Seed the local database with <code>npm run seed -w @cue/api</code>.
      </DevHint>
    </Notice>
  );
}

/**
 * The catalogue failed to load.
 *
 * The server's own message is shown as detail rather than spliced into the
 * body. Concatenating them produced "Could not reach the server The catalogue
 * didn't load." — the heading repeated, and two sentences run together,
 * because a message written by the API has no punctuation contract with a
 * sentence written here. Keeping them in separate elements means neither has
 * to know about the other, and the reader gets the plain explanation first and
 * the specifics underneath.
 */
function ErrorState({ t, message }: { t: Translator; message: string }) {
  return (
    <Notice
      title={t.t('common.unreachable')}
      body={t.t('home.failedBody')}
      detail={message}
      action={{ href: '/search', label: t.t('search.title') }}
    >
      <DevHint>
        Check that the API is running: <code>npm run dev -w @cue/api</code>.
      </DevHint>
    </Notice>
  );
}

/**
 * Left-aligned rather than centred.
 *
 * A centred block of text under a left-aligned masthead reads as a different
 * page fragment pasted in. It also puts the one control the reader needs in
 * the middle of the screen, away from the reading edge they are already on.
 */
function Notice({
  title,
  body,
  detail,
  action,
  children,
}: {
  title: string;
  body: string;
  /**
   * The server's own words, kept in their own element.
   *
   * Concatenating them into `body` produced "Could not reach the server The
   * catalogue didn't load." — two sentences run together, because a message
   * written by the API has no punctuation contract with one written here.
   */
  detail?: string;
  action: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-14 rounded-[var(--radius-lg)] bg-[var(--color-surface)] px-6 py-10">
      <h2 className="type-title3 m-0 text-[var(--color-text-primary)]">{title}</h2>
      <p className="type-callout mt-2 mb-0 max-w-[52ch] text-[var(--color-text-secondary)]">
        {body}
      </p>
      {detail ? (
        <p className="type-caption mt-2 mb-0 max-w-[52ch] text-[var(--color-text-tertiary)]">
          {detail}
        </p>
      ) : null}
      <Link
        href={action.href as Route}
        className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--color-ink)] px-5 type-body-strong text-[var(--color-text-on-ink)] no-underline transition-opacity hover:opacity-90"
      >
        {action.label}
      </Link>
      {children}
    </div>
  );
}

/** Shown only while developing, and never translated — it is a shell command. */
function DevHint({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'development') return null;

  return (
    <p className="type-caption mt-5 mb-0 text-[var(--color-text-tertiary)]">
      {children}
    </p>
  );
}
