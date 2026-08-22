'use client';

import { queryKeys, staleTime } from '@cue/api-client';
import { deriveCover } from '@cue/design';
import { useTranslator } from '@/components/i18n/locale-provider';
import type { Category, PodcastSearchResult, RecommendationReason } from '@cue/types';
import type { Translator } from '@cue/i18n';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as m from 'motion/react-m';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo, useState } from 'react';
import { Artwork } from '@/components/media/artwork';
import { PodcastTile } from '@/components/podcast/podcast-tile';
import { SectionHeader } from '@/components/ui/section-header';
import { api, ApiClientError } from '@/lib/api';
import { useOnline } from '@/lib/connectivity';
import { useCanTravel, useTransition } from '@/lib/motion';
import { useDebounced } from '@/lib/use-debounced';
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

/** How many categories get a tile before the rest become a list. */
const FEATURED_CATEGORIES = 4;
/** How many trending shows are ranked, before the rest become covers. */
const RANKED = 8;
/** How many of the rest get a cover. Three across, two rows. */
const COVERS = 6;
/** How many personalised shows lead the resting state. One row of six. */
const FOR_YOU = 6;

/**
 * The one empty list.
 *
 * `?? []` mints a fresh array every render, and memo compares props by
 * identity — new emptiness each time defeats the point. The trending sections
 * hold this one until the query has real results to pass instead.
 */
const NO_RESULTS: PodcastSearchResult[] = [];

/**
 * How long typing has to stop before a request goes out.
 *
 * Short enough to feel like the results are keeping up, long enough that the
 * gap between two letters of ordinary typing never clears it. Below about
 * 150ms this stops being a debounce and starts being a slower keystroke.
 */
const DEBOUNCE_MS = 250;

/** Characters a *typed* query needs before it is worth sending anywhere. */
const MIN_TYPED = 3;

/**
 * The query that actually gets sent, if any.
 *
 * Two thresholds, because two characters arrive in two different ways. Typed,
 * `jo` is somebody a third of the way through a word, and searching a global
 * directory for it returns a wall of unrelated shows that pushes the result
 * they wanted off the screen a moment later. Arriving in `?q=`, the same two
 * characters were typed and submitted somewhere else — on Home, or in a link
 * a friend sent — and refusing to run a search the reader has already
 * committed to would be the page arguing with them.
 *
 * The server's own floor stays at two either way, so nothing here can send it
 * something it would reject.
 */
function committedQuery(typed: string, seeded: string): string {
  if (typed.length >= MIN_TYPED) return typed;
  if (typed.length >= 2 && typed === seeded) return typed;
  return '';
}

/**
 * Search, and what to look at before you have searched.
 *
 * Three things make typing here feel instant while costing one request:
 *
 *  - The query is debounced, so a run of keystrokes settles once instead of
 *    firing a request per letter at a rate-limited directory. See
 *    `useDebounced` for why this replaced `useDeferredValue`, which looks like
 *    the same tool and is not.
 *  - Each request carries TanStack Query's `AbortSignal`, so the answer to a
 *    query nobody is waiting for any more is cancelled in flight rather than
 *    raced against the current one.
 *  - `keepPreviousData` holds the last results on screen while the next query
 *    resolves. Without it every keystroke blanks the list, which reads as the
 *    app losing its place.
 *
 * **An empty box is a screen, not a prompt.** A search page that waits to be
 * told what to do is a dead end for anyone who does not already know what they
 * want, which is most people opening a directory. So the resting state is the
 * catalogue's own shape — its categories, with real counts, and what the
 * directory says is trending.
 *
 * The two halves answer different questions on purpose. **Browsing is Cue's
 * catalogue; searching is the whole directory.** A category tile can only
 * count shows that have actually been ingested, and pretending otherwise would
 * mean tiles that open onto nothing.
 */
export function SearchClient({
  initialQuery = '',
  category = null,
}: {
  initialQuery?: string;
  category?: string | null;
}) {
  const t = useTranslator();
  // Seeded from the URL by the page above. Uncontrolled after that: this is
  // the field someone is typing in, and re-seeding it from a changing prop is
  // how a search box starts fighting the person using it.
  const [input, setInput] = useState(initialQuery);
  const [language, setLanguage] = useState('');

  const typed = useDebounced(input.trim(), DEBOUNCE_MS);
  const query = committedQuery(typed, initialQuery.trim());

  const searching = query.length > 0;
  /* Something has been typed, but not enough of it yet. A state of its own
     rather than a silent nothing: a screen that stops responding as soon as
     the first letter lands reads as broken, not as waiting. */
  const tooShort = !searching && typed.length > 0;
  const browsing = !searching && !tooShort && category !== null;

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
    // Not fetched while searching or browsing a category: it would be a second
    // upstream call for a list nobody can see, against a rate-limited
    // directory.
    enabled: !searching && !browsing,
    staleTime: staleTime.trending,
  });

  const results = search.data?.results ?? [];

  return (
    <div>
      <SearchField
        value={input}
        onChange={setInput}
        language={language}
        onLanguage={setLanguage}
      />

      {/* Announced politely so a screen reader learns the count without
          interrupting whatever the user is typing. */}
      <p aria-live="polite" className="sr-only">
        {searching && !search.isFetching
          ? t.t('search.resultCount', { count: results.length })
          : ''}
      </p>

      {searching ? (
        <div className="mt-8 max-w-[var(--measure-wide)]">
          {search.error ? <SearchError error={search.error} searching /> : null}

          {!search.error && search.isPending ? (
            <p className="type-callout text-[var(--color-text-secondary)]">
              {t.t('search.searching')}
            </p>
          ) : null}

          {!search.error && !search.isPending && results.length === 0 ? (
            <Advice title={t.t('search.noResults')} body={t.t('search.noResultsBody')} />
          ) : null}

          {/*
            The directory is down and these came from our own shelves.

            Said above the results rather than instead of them, because they are
            real matches and the listener may well have found what they wanted.
            What they must not do is conclude from a short list that the show
            they are looking for does not exist — which is exactly what a silent
            fallback invites, and the reason the server bothers to say so.
          */}
          {search.data?.degraded ? (
            <p className="type-caption mb-4 rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[var(--color-text-secondary)]">
              {t.t('search.degraded')}
            </p>
          ) : null}

          {results.length > 0 ? (
            <ul
              className="m-0 list-none p-0 transition-opacity duration-[var(--duration-fast)]"
              // Dim slightly while the next query resolves: the results are
              // still real, just one keystroke behind.
              style={{ opacity: search.isFetching ? 0.6 : 1 }}
            >
              {results.map((result) => (
                <li key={result.feedUrl}>
                  <ResultRow result={result} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : tooShort ? (
        <div className="mt-8 max-w-[var(--measure-wide)]">
          <Advice title={t.t('search.tooShort')} body={t.t('search.tooShortBody')} />
        </div>
      ) : browsing ? (
        <CategoryResults slug={category} />
      ) : (
        <>
          {/*
            What this listener would probably like, before what everyone likes.

            The resting state of Search used to open with trending — a global
            chart, identical for every account, which is the right thing to show
            somebody the app knows nothing about and the wrong thing to show
            somebody it does. Recommendations sit above it because the ranking
            behind them is the only thing on this screen fitted to the person
            reading it.

            It removes itself when the ranker has nothing to go on, rather than
            filling with popular shows under a personal heading — see `ForYou`.
          */}
          <ForYou />

          {/*
            Trending now lives inside Browse rather than as two more sections
            beneath it.

            They were always the same question asked twice — "what is worth
            opening when you have not searched for anything" — and stacking
            three top-level headings down one page made the resting state read
            as a list of features rather than as one screen. Browse is the
            heading that covers all of it: the categories are the deliberate
            way in, and the charts are the shortcut for someone who would
            rather be told.
          */}
          <CategoryBrowse
            trending={trending.data?.results ?? NO_RESULTS}
            trendingPending={trending.isPending}
            trendingError={trending.error}
          />
        </>
      )}
    </div>
  );
}

/**
 * More like what you have been listening to.
 *
 * The complaint this answers: Search offered a global trending chart and a
 * category grid, and nothing in between — so the way to find a fourth good
 * technology show was to read a list of the week's most popular podcasts in
 * general and hope. The ranker that fills Home's rail already answers exactly
 * this question, from this listener's own categories and hosts; it was just
 * never reachable from the screen people go to when they want more.
 *
 * **Absent until it can be honest.** The endpoint says whether the ordering is
 * actually personalised, and when it is not — a new account, or one that has
 * only pressed play once — this renders nothing at all. Filling the space with
 * popular shows under a heading claiming they match your taste is the specific
 * thing that makes recommendations feel like advertising: the section would be
 * *most* confident exactly when it knows least. Trending is directly below and
 * is the honest version of that offer.
 *
 * Six across rather than three. Home's rail is a considered suggestion at
 * editorial size; this is a shelf to browse, on the screen whose whole job is
 * browsing, so it trades size for reach.
 */
// Memoized: it takes no props and answers through its own query, so nothing
// typed in the field above is any of its business.
const ForYou = memo(function ForYou() {
  const t = useTranslator();
  const { isSignedIn } = useSession();

  const { data } = useQuery({
    queryKey: queryKeys.library.recommendations(),
    queryFn: () => api.getRecommendations({ limit: FOR_YOU }),
    enabled: isSignedIn,
    staleTime: staleTime.recommendations,
    // The rest of the page is the fallback. A rail failing to load is not worth
    // a retry storm against an endpoint that is already having a bad time.
    retry: false,
  });

  if (!data?.personalized || data.items.length === 0) return null;

  return (
    /* `mt-14`/`mb-16`: this sits directly under the search field, and the two
       were close enough that the rail read as part of the input's own chrome
       rather than as the first section of the page. */
    <section aria-labelledby="for-you-heading" className="mt-14 mb-16">
      <SectionHeader
        id="for-you-heading"
        label={t.t('search.forYou')}
        note={t.t('search.forYouNote')}
      />

      {/* `gap-y-9`: the caption under each cover is three lines at its longest,
          and at `gap-y-7` the last line of one row nearly touched the artwork
          of the next. */}
      <ul className="m-0 grid list-none grid-cols-2 gap-x-5 gap-y-9 p-0 sm:grid-cols-3 lg:grid-cols-6">
        {data.items.map((podcast) => (
          <li key={podcast.id}>
            <Link
              href={`/podcast/${podcast.id}` as Route}
              className="group block no-underline"
            >
              <div className="transition-transform duration-[var(--duration-fast)] ease-standard group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                <Artwork
                  src={podcast.artworkUrl}
                  alt={podcast.title}
                  size={180}
                  responsive
                  sizes="(min-width: 1024px) 16vw, (min-width: 640px) 30vw, 46vw"
                />
              </div>

              {/* The reason, in the accent, exactly as Home writes it. Two
                  surfaces disagreeing about why a show was chosen would make
                  both of them look arbitrary. */}
              <p className="type-overline clamp-1 mt-3 mb-1 text-[var(--color-accent-text)]">
                {reasonLabel(podcast.reason, t)}
              </p>

              <p className="type-body-strong clamp-2 m-0 text-[var(--color-text-primary)]">
                {podcast.title}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
});

/**
 * The reason a show is in the shelf, as a sentence.
 *
 * The server sends the fact — which signal won, and what it was — because it
 * does not know the reader's language. Assembled here, and identically on Home,
 * from the same three keys.
 */
function reasonLabel(reason: RecommendationReason, t: Translator): string {
  if (reason.kind === 'category' && reason.subject) {
    return t.t('home.becauseCategory', { subject: reason.subject });
  }
  if (reason.kind === 'creator' && reason.subject) {
    return t.t('home.becauseCreator', { subject: reason.subject });
  }
  return t.t('home.becausePopular');
}

/**
 * The field.
 *
 * A raised card rather than the pill Home uses, and the difference is not
 * decoration. On Home the field is a doorway sitting beside a page title — one
 * control among several, and a pill is what a control looks like here. On this
 * page it *is* the page: the only thing above the fold that anybody came to
 * use. Giving it a surface of its own and a shadow makes it the subject rather
 * than an accessory, which is the same reason a search engine's home page has
 * never been a pill in a toolbar.
 */
function SearchField({
  value,
  onChange,
  language,
  onLanguage,
}: {
  value: string;
  onChange: (next: string) => void;
  language: string;
  onLanguage: (next: string) => void;
}) {
  const t = useTranslator();

  return (
    <div className="flex max-w-[var(--measure-prose)] flex-col gap-3 sm:flex-row">
      <label className="relative flex flex-1 items-center">
        <span className="sr-only">Search podcasts</span>

        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          // `start-5` rather than `left-5`: the whole app mirrors under
          // Arabic, and an icon pinned left would sit on top of the text.
          className="pointer-events-none absolute start-5 text-[var(--color-text-tertiary)]"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>

        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type="search"
          placeholder={t.t('search.placeholderShort')}
          autoComplete="off"
          enterKeyHint="search"
          className={[
            'min-h-[54px] w-full rounded-[var(--radius-lg)] border-0 bg-[var(--color-surface-raised)]',
            // No `outline-none` here, deliberately: the global :focus-visible
            // ring is the only focus answer a keyboard user gets on a field
            // with no border to recolour.
            'ps-13 pe-5 text-[var(--color-text-primary)]',
            '[box-shadow:var(--elevation-sm)] placeholder:text-[var(--color-text-tertiary)]',
            // Focusing raises the card one step rather than just ringing it —
            // the field is the subject of this page, and the surface agrees.
            'transition-[box-shadow] duration-[var(--duration-fast)] ease-standard',
            'focus-visible:[box-shadow:var(--elevation-md)]',
            // The native clear button is an unstyleable cross belonging to no
            // palette we control, and `type="search"` is kept only for the
            // phone keyboard's Search key.
            '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
          ].join(' ')}
        />
      </label>

      <label className="block">
        <span className="sr-only">Filter by language</span>
        <select
          value={language}
          onChange={(event) => onLanguage(event.target.value)}
          className="min-h-[54px] w-full cursor-pointer rounded-[var(--radius-lg)] border-0 bg-[var(--color-surface-raised)] px-4 type-callout text-[var(--color-text-primary)] [box-shadow:var(--elevation-sm)] outline-none sm:w-auto"
        >
          {LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Browse by category.
 *
 * The first four get a tile and the rest get a line, which is the same move
 * Home makes with what is in progress: the hierarchy is the recommendation.
 * Four equal-sized tiles across the top and a quiet list underneath reads in
 * one glance; twelve tiles is a wall nobody scans.
 *
 * The tiles are ordered by how many shows are in them, so the shape of the
 * screen follows the shape of the catalogue rather than an alphabet.
 */
// Memoized, like ForYou: no props, one cached query, and typing is not one of
// the things that changes what a category grid shows.
const CategoryBrowse = memo(function CategoryBrowse({
  trending,
  trendingPending,
  trendingError,
}: {
  trending: PodcastSearchResult[];
  trendingPending: boolean;
  trendingError: unknown;
}) {
  const t = useTranslator();

  const { data, isPending } = useQuery({
    queryKey: queryKeys.discover.categories(),
    queryFn: () => api.listCategories(),
    staleTime: staleTime.categories,
  });

  const items = data?.items ?? [];

  // Absent rather than empty on a catalogue nobody has added to yet. A grid of
  // four grey rectangles labelled nothing is worse than starting at Trending.
  if (isPending || items.length === 0) return null;

  const featured = items.slice(0, FEATURED_CATEGORIES);
  const rest = items.slice(FEATURED_CATEGORIES);

  return (
    <section aria-labelledby="categories-heading" className="mt-16">
      <SectionHeader
        id="categories-heading"
        label={t.t('search.browse')}
        note={t.t('search.categoryCount', { count: items.length })}
      />

      <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 lg:grid-cols-4">
        {featured.map((category) => (
          <li key={category.slug}>
            <CategoryTile category={category} />
          </li>
        ))}
      </ul>

      {/*
        Every remaining category gets a tile too, rather than a row in a list.

        The list they replace was the honest layout when only four categories
        could be given artwork — but each of these carries a colour borrowed
        from a show inside it, so there was never a category that *could not*
        be drawn, only a decision that most of them would not be. That decision
        made the browse screen read as four categories and nineteen footnotes.

        Short rather than 4:3. A category is a destination, not a cover, and
        nineteen more square-ish tiles would push Trending off the bottom of
        the screen entirely — the exact failure the note on `CategoryTile`'s
        aspect ratio warns about, at six times the scale.
      */}
      {rest.length > 0 ? (
        <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((category) => (
            <li key={category.slug}>
              <CategoryTile category={category} compact />
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        Two lists of the same data, side by side, doing different jobs: the
        ranked one is for someone reading positions, the covers are for someone
        recognising a show they have heard of. Splitting one request between
        them costs nothing and beats a single column of twenty identical rows.

        Two equal columns, not a 1 : 1.2 split favouring the covers. Podcast
        covers are the loudest objects in the product — saturated, type-heavy,
        competing with each other — and giving them the larger half made the
        screen someone lands on before searching mostly a wall of other
        people's branding, with the editorial ranking whispering beside it.

        Separated by a rule rather than by margin alone. These are a different
        kind of answer from the tiles above them, and inside one section the
        only thing left to say so is a line.
      */}
      <div className="mt-12 border-t border-[var(--color-border)] pt-10">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
          <TrendingRanked
            results={trending}
            pending={trendingPending}
            error={trendingError}
          />
          <TrendingCovers results={trending} />
        </div>
      </div>
    </section>
  );
});

/**
 * One category, as a coloured tile.
 *
 * The colour is borrowed from a show inside it — see `deriveCover`. That is
 * the product's rule about colour holding even here: a category is the one
 * thing on this screen with no artwork of its own, and inventing a palette for
 * it is exactly the shortcut that would make the browse screen the only page
 * in the app with colours the catalogue did not supply.
 *
 * 4:3 rather than square. A square tile at this width is nearly as tall as a
 * cover, and a row of four would push trending off the screen entirely — but
 * the deeper reason is that these are not covers, and giving them a cover's
 * shape is how a reader ends up clicking a category expecting a show.
 */
function CategoryTile({
  category,
  /**
   * The same tile, short.
   *
   * Used for every category past the featured few. Same colour, same
   * watermark, same press behaviour — only the height and the type scale
   * change, so the grid below reads as more of the same thing rather than as a
   * second, lesser treatment.
   */
  compact = false,
}: {
  category: Category;
  compact?: boolean;
}) {
  const cover = category.accentColor ? deriveCover(category.accentColor) : null;
  const settle = useTransition('standard');
  const travel = useCanTravel();

  /*
    A tile that reads as a surface rather than as a missing image.

    The complaint this answers was "the category posters are blank", and the
    tiles were not broken — they were a flat two-stop gradient with two small
    labels in the corners, which at this size is a coloured rectangle. A cover
    slot the reader has learned to expect artwork in, filled with nothing, reads
    as a failed image load rather than as a deliberate design.

    Three things give it substance, none of which invent a colour the catalogue
    did not supply: a soft radial bloom that lifts one corner off the flat fill,
    a large initial watermarked into the surface at low opacity, and a hairline
    that keeps the tile's edge from dissolving into the page in the light theme.
  */
  const initial = category.name.trim().charAt(0).toUpperCase();

  return (
    <m.div
      // Spring on hover rather than a CSS transition, so an interrupted hover
      // resolves from wherever it got to instead of restarting.
      whileHover={travel ? { y: -3, scale: 1.015 } : {}}
      whileTap={travel ? { scale: 0.99 } : {}}
      transition={settle}
      className="h-full"
    >
      <Link
        href={`/search?category=${category.slug}` as Route}
        className={[
          'group relative flex flex-col justify-between overflow-hidden no-underline',
          compact
            ? 'h-[86px] rounded-[var(--radius-md)] p-3'
            : 'aspect-4/3 rounded-[var(--radius-lg)] p-4',
          cover ? '' : 'border border-[var(--color-border)]',
        ].join(' ')}
        style={{
          background: cover
            ? `linear-gradient(135deg, ${cover.from}, ${cover.to})`
            : 'var(--color-surface-raised)',
        }}
      >
        {/* The bloom. Sits under everything and is purely tonal — white at
            6%, so it reads as light falling on the surface rather than as a
            second colour competing with the show's own. */}
        {cover ? (
          <span
            aria-hidden="true"
            className={[
              'pointer-events-none absolute -top-1/4 -right-1/4 h-3/4 w-3/4 rounded-full',
              'opacity-70 transition-opacity duration-[var(--duration-base)] ease-standard',
              'group-hover:opacity-100',
            ].join(' ')}
            style={{
              background:
                'radial-gradient(circle at center, rgba(255,255,255,0.16), rgba(255,255,255,0) 70%)',
            }}
          />
        ) : null}

        {/* The watermark. Clipped by the tile and bled off its bottom edge, so
            it is texture rather than a letter sitting in a box — and `leading-none`
            because a glyph this size carries enormous line-box padding that would
            otherwise push it out of the crop entirely. */}
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute leading-none font-semibold select-none',
            'transition-transform duration-[var(--duration-slow)] ease-standard',
            'group-hover:-translate-y-1 motion-reduce:group-hover:translate-y-0',
            compact ? '-end-1 -bottom-5 text-[4.5rem]' : '-end-2 -bottom-8 text-[7rem]',
            cover ? 'text-white/10' : 'text-[var(--color-text-primary)]/5',
          ].join(' ')}
        >
          {initial}
        </span>

        <span
          className={[
            'relative clamp-2',
            compact ? 'type-body-strong' : 'type-title3',
            cover ? 'text-white' : 'text-[var(--color-text-primary)]',
          ].join(' ')}
        >
          {category.name}
        </span>

        {/* The count, given a pill so it reads as a fact about the tile rather
            than as a stray number floating in the corner. */}
        <span
          className={[
            'relative w-fit rounded-full px-2 py-0.5 type-caption',
            cover
              ? 'bg-black/20 text-white/90'
              : 'bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]',
          ].join(' ')}
        >
          {category.count}
        </span>
      </Link>
    </m.div>
  );
}

/**
 * One category's shows, from Cue's own catalogue.
 *
 * What a tile opens onto. Deliberately the plain grid rather than a second
 * results layout: it is the same kind of answer the front page's catalogue
 * gives, narrowed, and a category that looked like a different product from
 * the rest of the app would be the tell that it was bolted on.
 */
function CategoryResults({ slug }: { slug: string }) {
  const t = useTranslator();

  const list = useQuery({
    queryKey: queryKeys.discover.inCategory(slug),
    queryFn: () => api.getPodcasts({ category: slug, limit: 40 }),
    staleTime: staleTime.podcast,
  });

  const categories = useQuery({
    queryKey: queryKeys.discover.categories(),
    queryFn: () => api.listCategories(),
    staleTime: staleTime.categories,
  });

  const name =
    categories.data?.items.find((item) => item.slug === slug)?.name ?? slug;
  const items = list.data?.items ?? [];

  return (
    <section aria-labelledby="category-heading" className="mt-10">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <h2 id="category-heading" className="type-display m-0 text-[var(--color-text-primary)]">
            {name}
          </h2>
          {list.isPending ? null : (
            <p className="type-callout mt-1 mb-0 text-[var(--color-text-tertiary)]">
              {t.t('search.inCatalogue', { count: items.length })}
            </p>
          )}
        </div>

        <Link
          href={'/search' as Route}
          className="type-callout shrink-0 text-[var(--color-text-tertiary)] no-underline underline-offset-4 transition-colors hover:text-[var(--color-text-primary)] hover:underline"
        >
          {t.t('search.allCategories')}
        </Link>
      </div>

      {list.error ? <SearchError error={list.error} searching={false} /> : null}

      {items.length > 0 ? (
        <ul className="grid list-none grid-cols-2 gap-x-5 gap-y-7 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((podcast, index) => (
            <li key={podcast.id}>
              <PodcastTile podcast={podcast} priority={index < 5} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Trending, ranked.
 *
 * The number is the content. A trending list without positions is just a list,
 * and the whole reason anyone reads one is to see what is above what.
 */
// Memoized: its props are the cache's own array plus two primitives, so only
// an actual answer re-renders the ranking — not a keystroke in the field.
const TrendingRanked = memo(function TrendingRanked({
  results,
  pending,
  error,
}: {
  results: PodcastSearchResult[];
  pending: boolean;
  error: unknown;
}) {
  const t = useTranslator();

  return (
    <section aria-labelledby="trending-heading">
      <h2
        id="trending-heading"
        className="type-overline m-0 mb-3 text-[var(--color-text-tertiary)]"
      >
        {t.t('search.trending')}
      </h2>

      {error ? <SearchError error={error} searching={false} /> : null}
      {!error && pending ? (
        <p className="type-callout text-[var(--color-text-secondary)]">Loading…</p>
      ) : null}

      <ul className="m-0 list-none p-0">
        {results.slice(0, RANKED).map((result, index) => (
          <li key={result.feedUrl}>
            <RankedRow result={result} rank={index + 1} />
          </li>
        ))}
      </ul>
    </section>
  );
});

/**
 * One ranked row.
 *
 * Memoized because typing re-renders this page far more often than the
 * trending query answers, and a row whose result has not changed has no
 * reason to take part in any of that.
 */
const RankedRow = memo(function RankedRow({
  result,
  rank,
}: {
  result: PodcastSearchResult;
  rank: number;
}) {
  const open = useOpenResult(result);

  return (
    <button
      type="button"
      onClick={() => open.mutate()}
      disabled={open.isPending}
      className="flex w-full cursor-pointer items-baseline gap-4 rounded-[var(--radius-md)] border-0 border-b border-[var(--color-border)] bg-transparent px-0 py-3.5 text-start transition-transform duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-wait disabled:opacity-60"
    >
      {/* Padded to two digits so the titles line up in a column rather than
          stepping right when the list reaches ten. */}
      <span className="type-timecode w-6 shrink-0 text-[var(--color-accent-text)]">
        {String(rank).padStart(2, '0')}
      </span>

      <span className="min-w-0 flex-1">
        <span className="type-body-strong clamp-1 block text-[var(--color-text-primary)]">
          {result.title}
        </span>
        <span className="type-caption clamp-1 mt-0.5 block text-[var(--color-text-tertiary)]">
          {[result.categories[0], result.author].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  );
});

/**
 * The same list, as covers.
 *
 * For the reader who is not ranking anything and is scanning for artwork they
 * recognise — which, for a directory nobody has curated for them, is most
 * people. It starts where the ranked list stops, so nothing is shown twice.
 */
// Memoized for the same reason as the ranked list beside it: typing in the
// field is not one of the things that moves a cover.
const TrendingCovers = memo(function TrendingCovers({
  results,
}: {
  results: PodcastSearchResult[];
}) {
  const t = useTranslator();
  const covers = results.slice(RANKED, RANKED + COVERS);

  if (covers.length === 0) return null;

  return (
    <section aria-labelledby="more-trending-heading">
      <h2
        id="more-trending-heading"
        className="type-overline m-0 mb-3 text-[var(--color-text-tertiary)]"
      >
        {t.t('search.alsoRising')}
      </h2>

      <ul className="m-0 grid list-none grid-cols-3 gap-x-4 gap-y-5 p-0">
        {covers.map((result) => (
          <li key={result.feedUrl}>
            <CoverCard result={result} />
          </li>
        ))}
      </ul>
    </section>
  );
});

/**
 * One cover.
 *
 * Memoized for the same reason as RankedRow: the field redraws the page per
 * keystroke; a cover only moves when the trending query answers.
 */
const CoverCard = memo(function CoverCard({
  result,
}: {
  result: PodcastSearchResult;
}) {
  const open = useOpenResult(result);

  return (
    <button
      type="button"
      onClick={() => open.mutate()}
      disabled={open.isPending}
      className="w-full cursor-pointer rounded-[var(--radius-md)] border-0 bg-transparent p-0 text-start transition-transform duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-wait disabled:opacity-60"
    >
      <Artwork
        src={result.artworkUrl}
        alt=""
        size={160}
        responsive
        sizes="(min-width: 1024px) 160px, 28vw"
      />
      <span className="type-body-strong clamp-1 mt-2.5 block text-[var(--color-text-primary)]">
        {result.title}
      </span>
      {result.author ? (
        <span className="type-caption clamp-1 mt-0.5 block text-[var(--color-text-tertiary)]">
          {result.author}
        </span>
      ) : null}
    </button>
  );
});

/**
 * Read a directory feed and go to the show it turns into.
 *
 * Directory results have no id — they are not in our database — so there is
 * nothing to link to until the feed has been read. That is why every one of
 * these is a button rather than an anchor, and why opening one is a mutation:
 * it *creates* the show. It is still not a commitment, though. Nothing lands
 * in anybody's library until Follow is pressed.
 */
function useOpenResult(result: PodcastSearchResult) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => ingestFeed(result.feedUrl, queryClient),
    onSuccess: (podcast) => router.push(`/podcast/${podcast.id}`),
  });
}

async function ingestFeed(
  feedUrl: string,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const { podcast } = await api.addPodcast(feedUrl);
  // Seed the detail page's cache so it renders instantly rather than
  // re-fetching what we were just handed.
  queryClient.setQueryData(queryKeys.podcast.detail(podcast.id), { podcast });
  void queryClient.invalidateQueries({ queryKey: queryKeys.podcast.list() });
  return podcast;
}

/**
 * One directory hit.
 *
 * The whole row *was* "add", which meant looking at a show and keeping a show
 * were the same gesture: you could not open one to see what it was without
 * putting it in your library. Now the row opens it and the button on the end
 * follows it.
 *
 * Memoized: every keystroke before the debounce settles re-renders this page,
 * and a hit already on screen does not change between them.
 */
const ResultRow = memo(function ResultRow({
  result,
}: {
  result: PodcastSearchResult;
}) {
  const t = useTranslator();
  const queryClient = useQueryClient();
  const { isSignedIn } = useSession();

  const open = useOpenResult(result);

  const follow = useMutation({
    mutationFn: async () => {
      const podcast = await ingestFeed(result.feedUrl, queryClient);
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
    result.episodeCount === null
      ? null
      : t.t('podcast.episodeCount', { count: result.episodeCount }),
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
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-[var(--radius-md)] border-0 bg-transparent py-4 text-start transition-transform duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-wait disabled:opacity-60"
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
            className="shrink-0 cursor-pointer rounded-full border border-[var(--color-border-strong)] bg-transparent px-4 py-2 type-caption text-[var(--color-text-primary)] transition-transform duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-default disabled:opacity-60"
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
            className="shrink-0 rounded-full border border-[var(--color-border-strong)] px-4 py-2 type-caption text-[var(--color-text-primary)] no-underline transition-transform duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100"
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
});

/**
 * A state that is neither a result nor a fault.
 *
 * Too short, nothing matched, offline: three different answers that all have
 * to occupy the space the results were going to. Set at the same weight as a
 * section heading rather than as body text, because at body weight an empty
 * results area reads as a page that failed to finish rendering.
 */
function Advice({ title, body }: { title: string; body?: string }) {
  return (
    <div>
      <p className="type-title3 m-0 text-[var(--color-text-primary)]">{title}</p>
      {body ? (
        <p className="type-callout mt-1.5 mb-0 max-w-[52ch] text-[var(--color-text-secondary)]">
          {body}
        </p>
      ) : null}
    </div>
  );
}

function SearchError({ error, searching }: { error: unknown; searching: boolean }) {
  const t = useTranslator();
  const online = useOnline();

  /*
    Offline is a situation, not a failure.

    Every request on this page fails the same way in a tunnel as it does
    against a broken server, and the raw error — "Failed to fetch" — describes
    neither. Checking the connection first means the reader is told the one
    thing that is actually true and actionable, instead of being sent to debug
    a server that is fine.
  */
  if (!online) {
    return <Advice title={t.t('offline.title')} body={t.t('offline.pageBody')} />;
  }

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

  return <Advice title={t.t('common.unreachable')} body={message} />;
}
