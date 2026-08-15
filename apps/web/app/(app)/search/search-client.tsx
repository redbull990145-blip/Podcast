'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import { useTranslator } from '@/components/i18n/locale-provider';
import type { PodcastSearchResult } from '@cue/types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { Artwork } from '@/components/media/artwork';
import { api, ApiClientError } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Languages offered as a filter.
 *
 * Labelled in their own script, not in English. Someone scanning for Hindi
 * shows finds हिन्दी faster than a row that says "Hindi" — and a language
 * picker that names every language in one language is the clearest sign it was
 * built for one audience.
 */
const LANGUAGES = [
  { code: '', label: 'Any language' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
] as const;

/**
 * Search, and what to look at before you have searched.
 *
 * Two things make typing here feel instant:
 *
 *  - `useDeferredValue` keeps the input responsive under load. React renders
 *    the keystroke immediately and the (expensive) result list at lower
 *    priority, so the caret never lags behind the typing.
 *  - `keepPreviousData` holds the last results on screen while the next query
 *    resolves. Without it every keystroke blanks the list, which reads as the
 *    app losing its place.
 *
 * An empty box shows what is trending rather than an instruction. A search
 * screen that waits to be told what to do is a dead end for anyone who does
 * not already know what they want — which is most people opening a directory.
 */
export function SearchClient() {
  const t = useTranslator();
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState('');
  const query = useDeferredValue(input.trim());

  const searching = query.length >= 2;

  const search = useQuery({
    queryKey: queryKeys.discover.search(query, language),
    queryFn: ({ signal }) =>
      api.searchPodcasts(query, { signal, ...(language ? { language } : {}) }),
    enabled: searching,
    staleTime: staleTime.search,
    placeholderData: keepPreviousData,
  });

  const trending = useQuery({
    queryKey: queryKeys.discover.trending(language),
    queryFn: () => api.trendingPodcasts({ ...(language ? { language } : {}), limit: 20 }),
    // Not fetched while searching: it would be a second upstream call for a
    // list nobody can see, against a rate-limited directory.
    enabled: !searching,
    staleTime: staleTime.trending,
  });

  const active = searching ? search : trending;
  const results = (searching ? search.data?.results : trending.data?.results) ?? [];

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="block flex-1">
          <span className="sr-only">Search podcasts</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            type="search"
            placeholder={t.t('search.placeholderShort')}
            autoComplete="off"
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus-visible:border-[var(--color-accent)]"
          />
        </label>

        <label className="block">
          <span className="sr-only">Filter by language</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="min-h-[46px] w-full cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 type-callout text-[var(--color-text-primary)] outline-none focus-visible:border-[var(--color-accent)] sm:w-auto"
          >
            {LANGUAGES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Announced politely so a screen reader learns the count without
          interrupting whatever the user is typing. */}
      <p aria-live="polite" className="sr-only">
        {searching && !active.isFetching ? t.t('search.resultCount', { count: results.length }) : ''}
      </p>

      <div className="mt-6">
        {!searching && !trending.isError ? (
          <h2 className="type-overline mb-2 text-[var(--color-text-tertiary)]">
            TRENDING NOW
          </h2>
        ) : null}

        {active.error ? <SearchError error={active.error} searching={searching} /> : null}

        {!active.error && active.isPending ? (
          <p className="type-callout text-[var(--color-text-secondary)]">
            {searching ? 'Searching…' : 'Loading…'}
          </p>
        ) : null}

        {searching && !active.error && !active.isPending && results.length === 0 ? (
          <p className="type-callout text-[var(--color-text-secondary)]">
            Nothing matched “{query}”.
          </p>
        ) : null}

        {results.length > 0 ? (
          <ul
            className="m-0 list-none p-0 transition-opacity duration-[var(--duration-fast)]"
            // Dim slightly while the next query resolves: the results are
            // still real, just one keystroke behind.
            style={{ opacity: active.isFetching ? 0.6 : 1 }}
          >
            {results.map((result) => (
              <li key={result.feedUrl}>
                <ResultRow result={result} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One directory hit.
 *
 * These come from upstream and are not in our database, so they have no id and
 * nothing to link to yet. Reading the feed is what gives a show an id, so both
 * controls here have to do that first — but they are genuinely two different
 * intentions and used to be one button.
 *
 * The whole row *was* "add", which meant looking at a show and keeping a show
 * were the same gesture: you could not open one to see what it was without
 * putting it in your library. Now the row opens it and the button on the end
 * follows it. Reading the feed still happens either way, because there is no
 * page to show without it — but that is a fetch, not a commitment, and nothing
 * lands in anybody's library until the button is pressed.
 */
function ResultRow({ result }: { result: PodcastSearchResult }) {
  const t = useTranslator();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isSignedIn } = useSession();

  /** Read the feed and hand back the id everything else needs. */
  async function ingest() {
    const { podcast } = await api.addPodcast(result.feedUrl);
    // Seed the detail page's cache so it renders instantly rather than
    // re-fetching what we were just handed.
    queryClient.setQueryData(queryKeys.podcast.detail(podcast.id), { podcast });
    void queryClient.invalidateQueries({ queryKey: queryKeys.podcast.list() });
    return podcast;
  }

  const open = useMutation({
    mutationFn: ingest,
    onSuccess: (podcast) => router.push(`/podcast/${podcast.id}`),
  });

  const follow = useMutation({
    mutationFn: async () => {
      const podcast = await ingest();
      await api.subscribe(podcast.id);
      return podcast;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.subscriptions() });
    },
  });

  const busy = open.isPending || follow.isPending;
  const error = open.error ?? follow.error;

  const meta = [
    result.author,
    result.episodeCount === null ? null : t.t('podcast.episodeCount', { count: result.episodeCount }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="border-b border-[var(--color-border)] last:border-b-0">
      {/* A row, not a button containing a button — nesting one inside the other
          is invalid HTML and the inner click would fire both. */}
      <div className="flex items-center gap-4 px-1">
        <button
          type="button"
          onClick={() => open.mutate()}
          disabled={busy}
          aria-busy={open.isPending || undefined}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 border-0 bg-transparent py-4 text-start transition-opacity disabled:cursor-wait disabled:opacity-60"
        >
          <Artwork src={result.artworkUrl} alt={result.title} size={56} />

          <span className="min-w-0 flex-1">
            <span className="type-body-strong clamp-1 block text-[var(--color-text-primary)]">
              {result.title}
            </span>
            {meta ? (
              <span className="type-callout clamp-1 mt-0.5 block text-[var(--color-text-secondary)]">
                {meta}
              </span>
            ) : null}
          </span>
        </button>

        {/* Following needs an account, so signed out this is a link to sign in
            rather than a button that fails after the fact. */}
        {isSignedIn ? (
          <button
            type="button"
            onClick={() => follow.mutate()}
            disabled={busy || follow.isSuccess}
            className="shrink-0 cursor-pointer rounded-full border border-[var(--color-border)] bg-transparent px-4 py-2 type-caption text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-60"
          >
            {follow.isSuccess
              ? t.t('search.added')
              : follow.isPending
                ? t.t('search.adding')
                : t.t('search.add')}
          </button>
        ) : (
          <Link
            href={'/signin' as Route}
            className="shrink-0 rounded-full border border-[var(--color-border)] px-4 py-2 type-caption text-[var(--color-text-secondary)] no-underline transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]"
          >
            {t.t('search.add')}
          </Link>
        )}
      </div>

      {error ? (
        <p role="alert" className="type-caption mt-0 mb-3 px-1 text-[var(--color-danger)]">
          {error instanceof ApiClientError ? error.message : 'Could not open that show.'}
        </p>
      ) : null}
    </div>
  );
}

function SearchError({ error, searching }: { error: unknown; searching: boolean }) {
  // A server without PodcastIndex credentials is a setup problem, not a bug,
  // and saying so is more useful than "something went wrong".
  const message =
    error instanceof ApiClientError && error.code === 'upstream_unavailable'
      ? 'Search needs PODCASTINDEX_KEY and PODCASTINDEX_SECRET in .env.'
      : error instanceof Error
        ? error.message
        : searching
          ? 'Search failed.'
          : 'Could not load trending shows.';

  return <p className="type-callout text-[var(--color-text-secondary)]">{message}</p>;
}
