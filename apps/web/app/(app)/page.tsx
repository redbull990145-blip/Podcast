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
import { Recommended } from '@/components/home/recommended';
import { api, ApiClientError } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';

/**
 * Home.
 *
 * Rendered on the server so the first paint carries real content rather than
 * a skeleton that resolves a moment later — the fastest loading state is the
 * one that never appears.
 *
 * Revalidated rather than rendered per request: podcast metadata changes when
 * a publisher edits it, which is rarely, so serving a cached page and
 * refreshing it in the background is both faster and cheaper than querying on
 * every visit.
 *
 * The page answers four questions, in the order people actually ask them:
 *
 *  1. *Where was I?* — Continue listening, for anyone with something running.
 *  2. *What can I play right now?* — the newest episode from each active show.
 *  3. *What should I play next?* — the catalogue, ordered for the reader when
 *     there is enough listening behind them to order it by.
 *  4. *What if none of this is it?* — the directory, via search.
 *
 * It used to answer only the third, which is the one almost nobody arrives
 * asking.
 */
export const revalidate = 300;

export default async function HomePage() {
  const t = await getTranslator();

  let podcasts: Podcast[] = [];
  let failure: string | null = null;

  try {
    // Matches `RAIL` in `Recommended`, which may replace this list in the same
    // grid. Two different lengths would shift the page as it personalises.
    const page = await api.getPodcasts({ limit: 18 });
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
        Above the catalogue, and client-rendered while the page around it is
        static. What is in progress is per-listener and changes by the minute,
        so it cannot share the page's 5-minute cache — and it must not stop the
        rest of Home from being served instantly to everyone.
      */}
      <ContinueListening />

      {failure ? <ErrorState t={t} message={failure} /> : null}
      {!failure && !hasCatalogue ? <EmptyState t={t} /> : null}

      {hasCatalogue ? (
        <>
          {/*
            Streamed. The episodes behind this section come from one request
            per show, and the catalogue below already has everything it needs —
            so making the grid wait on them would trade a fast page for a
            slightly fuller one. The fallback claims the space so nothing
            further down moves when they land.
          */}
          <Suspense fallback={<LatestEpisodesSkeleton />}>
            <LatestEpisodes podcasts={podcasts} />
          </Suspense>

          {/*
            The catalogue, re-ordered for whoever is reading it.

            Server-rendered shows go in as the fallback rather than being
            rendered here: personalisation is per-listener and this page is
            cached for everybody, so the ordering has to be decided on the
            client. Passing the list down means the grid is full on first paint
            either way — see `Recommended` for why this is one section and not
            a rail stacked on top of a catalogue.
          */}
          <Recommended fallback={podcasts} />

          <DirectoryPrompt t={t} />
        </>
      ) : null}
    </div>
  );
}

/**
 * The way out of a page that has run out.
 *
 * The catalogue is only what people have already added, so on a young install
 * it ends after a dozen covers with nothing after it — a scroll that stops
 * dead. This says what the grid cannot: that the thing you are looking for is
 * probably not missing, it is just in the directory rather than here yet.
 */
function DirectoryPrompt({ t }: { t: Translator }) {
  return (
    <aside className="border-t border-[var(--color-border)] pt-8">
      <h2 className="type-title3 m-0 text-[var(--color-text-primary)]">
        {t.t('home.moreTitle')}
      </h2>
      <p className="type-callout mt-1.5 mb-0 max-w-[52ch] text-[var(--color-text-secondary)]">
        {t.t('home.moreBody')}
      </p>
      <Link
        href={'/search' as Route}
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-[var(--color-border-strong)] px-5 type-body-strong text-[var(--color-text-primary)] no-underline transition-colors hover:bg-[var(--color-surface-hover)]"
      >
        {t.t('search.title')}
      </Link>
    </aside>
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
