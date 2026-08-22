import type { Podcast } from '@cue/types';
import type { Metadata, Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ApiClientError } from '@cue/api-client';
import { getTranslator } from '@/lib/i18n';
import { deriveTint, tintVars } from '@cue/design';
import { ChromeTint } from '@/components/shell/chrome-tint';
import { Artwork } from '@/components/media/artwork';
import { ShowNotice } from '@/components/podcast/show-notice';
import { SubscribeButton } from '@/components/podcast/subscribe-button';
import { EpisodeRow } from '@/components/episode/episode-row';
import { EpisodePager } from '@/components/podcast/episode-pager';
import { api } from '@/lib/api';

export const revalidate = 300;

/**
 * Ten to a page.
 *
 * Small enough to read without scrolling past the pager, which is what makes
 * stepping through an archive feel like turning pages rather than like
 * scrolling with extra steps.
 */
const EPISODES_PER_PAGE = 10;

type Params = {
  params: Promise<{ id: string }>;
  /**
   * The archive's page number.
   *
   * A promise, and deliberately awaited *inside* the suspended list rather than
   * here: reading search params in the page body opts the whole route out of
   * static rendering, so the header, the description and the artwork — none of
   * which depend on the page number — would be re-rendered per request for the
   * sake of one list below them.
   */
  searchParams: Promise<{ page?: string }>;
};

/**
 * Real titles and descriptions in the document head — this is a public
 * catalogue, and a podcast page that shares as "Cue" is a wasted link.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;

  try {
    const { podcast } = await api.getPodcast(id);
    return {
      title: podcast.title,
      description: podcast.description?.slice(0, 160) ?? undefined,
      openGraph: {
        title: podcast.title,
        description: podcast.description?.slice(0, 160) ?? undefined,
        images: podcast.artworkUrl ? [podcast.artworkUrl] : undefined,
        type: 'website',
      },
    };
  } catch {
    return { title: 'Podcast' };
  }
}

export default async function PodcastPage({ params, searchParams }: Params) {
  const { id } = await params;

  let data: Awaited<ReturnType<typeof api.getPodcast>>;
  try {
    data = await api.getPodcast(id);
  } catch (error) {
    // A missing show is a 404, not a 500 — it renders the real not-found page
    // and returns the right status to crawlers.
    if (error instanceof ApiClientError && error.code === 'not_found') notFound();
    throw error;
  }

  const { podcast } = data;

  /**
   * The show's own colour, lifted from its artwork — and applied to the whole
   * window rather than to a band at the top of it.
   *
   * This is where the product gets to be colourful without inventing a palette.
   * It used to be a 380px gradient behind the header, which is the cautious
   * version and reads as one: the colour ran out a third of the way down and
   * the rest of the page was the same grey every other page is, so opening a
   * show felt like the app had put a sticker on a document. Apple Music
   * repaints the *room* an album is in, and the reason that works is that the
   * colour is still there when you have scrolled to track eleven.
   *
   * `tintedScheme` re-declares the colour variables for this subtree, so every
   * component below repaints — rows, borders, buttons, the episode list — with
   * none of them knowing the page is tinted. It also darkens and desaturates
   * hard on the way through, which is not decoration: the extracted colour is
   * the *brightest* region of the cover, so a page painted in it would put the
   * artwork on a ground made of its own highlights.
   *
   * Rendered server-side, so the colour is in the first paint rather than
   * arriving after an image decodes. It is a property of the show and not of
   * the reader, so it survives this page's shared cache.
   */
  const tint = tintVars(podcast.accentColor);
  /*
    The saturated fill, which is theme-independent by construction.

    `deriveTint` returns the same `fill` for both themes — it is a strong
    background that carries its own foreground, so unlike `wash` and `text` it
    does not depend on what is behind it. That is why it is the one value here
    that can still be read off a single call rather than resolved through CSS,
    and why `tintVars` has no `-dark`/`-light` pair for it.
  */
  const fill = podcast.accentColor
    ? (deriveTint(podcast.accentColor, 'dark')?.fill ?? null)
    : null;
  const t = await getTranslator();

  return (
    <div
      // `min-h-dvh` so a show with four episodes is still in its own room
      // rather than a coloured strip on top of the app's background — the
      // failure the old fixed-height wash had, one level up.
      className="relative min-h-dvh bg-[var(--color-bg)]"
      /*
        Painted by the same rule that paints the chrome, rather than by an
        inline palette of its own.

        This used to spread `colorVarStyle(tintedScheme(...))` here, which had
        two problems and they were the same problem: an inline style can hold
        one value per property, so it could only ever carry the dark palette,
        and a light-theme listener got a dark page. `ChromeTint` already emits
        both variants under `[data-chrome-tint]` and lets the stylesheet pick,
        so wearing that attribute gets the page the correct one for free —
        and guarantees the page and the rail beside it cannot disagree, which
        two independently-computed palettes eventually would.
      */
      data-chrome-tint=""
    >
      {/* And the same palette on the rail and the player bar, so the window is
          one object rather than a coloured page with the app's own chrome
          bolted to two of its edges. */}
      <ChromeTint color={podcast.accentColor} />

      {/*
        A last brightening at the very top, where the cover is.

        The page ground is deliberately flat — a full-height gradient is a
        surface nobody can lay text on predictably. This is the one place the
        colour is allowed to be stronger, because it is the one place there is
        already a 220px source of it: the artwork sits in this band, and the
        light appears to come off it.

        Outside the width-capped column on purpose. As a child of that column
        `inset-x-0` means "the column", so on a wide window the colour stopped
        dead at the text with plain background either side of it — and light
        coming off a cover does not stop in a straight line.
      */}
      {tint ? (
        <div
          aria-hidden="true"
          data-tint=""
          className="pointer-events-none absolute inset-x-0 top-0 h-[300px] sm:h-[380px]"
          style={{
            ...tint,
            background: `linear-gradient(to bottom, var(--tint-wash) 0%, transparent 100%)`,
            // Screened on a dark ground and multiplied on paper — see
            // `--tint-blend` in globals.css. Hardcoding `screen` here meant the
            // band computed back to near-white and disappeared entirely in the
            // light theme, taking the one place the cover's colour is allowed
            // to be strong with it.
            mixBlendMode: 'var(--tint-blend)' as React.CSSProperties['mixBlendMode'],
            zIndex: 0,
          }}
        />
      ) : null}

      <div className="relative mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      {/*
        Cover and identity, side by side.

        The notice used to be pinned to the far-right edge of this row, level
        with the poster — which put it nowhere near the button it is a second
        chance at, floating alone over a wide gap with nothing tying it to
        anything else on the page. It reads right when it reads as *part of the
        Follow row*, not as a separate widget that happens to share a header.
      */}
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
        <Artwork src={podcast.artworkUrl} alt={podcast.title} size={220} priority />

        <div className="min-w-0 flex-1">
          {/* The heading comes first and carries its own weight. Metadata sits
              below it, where it belongs — a label above a title is a caption
              pretending to be a hierarchy. */}
          <h1 className="type-display mt-0 mb-0 text-[var(--color-text-primary)]">
            {podcast.title}
          </h1>

          {podcast.author ? (
            <p className="type-body-strong mt-1.5 mb-0 text-[var(--color-text-secondary)]">
              {podcast.author}
            </p>
          ) : null}

          <p className="type-caption mt-3 mb-0 text-[var(--color-text-tertiary)]">
            {[
              podcast.episodeCount !== null
                ? t.t('podcast.episodeCount', { count: podcast.episodeCount })
                : null,
              podcast.categories[0] ?? null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {/* Follow and the notice, in one row and on one baseline — the
              notice is offering the same action Follow is, so the two controls
              read as a single decision rather than as a page element and an
              unrelated banner beneath it. */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <SubscribeButton
              podcastId={podcast.id}
              {...(fill ? { tint: fill } : {})}
            />

            <ShowNotice
              podcastId={podcast.id}
              source={podcast.source}
              {...(fill ? { tint: fill } : {})}
            />
          </div>
        </div>
      </header>

      {/*
        Full content width, not a reading measure.

        A show description is not an article — it is four lines of blurb read
        once, and capping it to `--measure-prose` left it ending well short of
        the episode rows directly beneath it. Two blocks in the same column
        with different right edges reads as one of them being misaligned, and
        on this page the shorter one is the paragraph rather than the list.

        Balanced wrapping so the last line is not a single orphaned word, which
        is the failure mode a wide measure introduces and the narrow one hid.
      */}
      {podcast.description ? (
        <p className="type-body mb-10 text-pretty text-[var(--color-text-secondary)]">
          {podcast.description}
        </p>
      ) : null}

      <section aria-label={t.t('podcast.episodes')}>
        <h2 className="type-title2 mb-3 text-[var(--color-text-primary)]">{t.t('podcast.episodes')}</h2>

        {/*
          Suspended so the page above it stays static.

          Everything else on this screen is a property of the show and is the
          same for everybody, which is what the five-minute revalidate is for.
          The list is the one part that depends on a query string, so it is the
          only part that renders per request.
        */}
        <Suspense fallback={<EpisodeListSkeleton />}>
          <EpisodeArchive
            podcast={podcast}
            searchParams={searchParams}
            {...(fill ? { tint: fill } : {})}
          />
        </Suspense>
      </section>
      </div>
    </div>
  );
}

/**
 * One page of the archive, and the pager under it.
 *
 * Ten rows rather than thirty. Thirty was chosen when this list had no way
 * forward and the number had to stand in for "enough" — with paging, the right
 * page size is the one you can take in without scrolling past it, and ten rows
 * of a two-line episode row is about a screen.
 */
async function EpisodeArchive({
  podcast,
  searchParams,
  tint,
}: {
  podcast: Podcast;
  searchParams: Promise<{ page?: string }>;
  tint?: string;
}) {
  const t = await getTranslator();
  const { page: requested } = await searchParams;
  const basePath = `/podcast/${podcast.id}`;

  /*
    A page number outside the archive is corrected in the URL, not just in the
    content.

    Serving the last page's episodes under `?page=296` was the first attempt and
    it is worse than it looks: the address bar, the pager and the list disagree,
    reloading gives the same wrong URL back, and the page is now reachable at
    infinitely many addresses — `?page=296`, `?page=4000` — which is one canonical
    URL problem and one caching problem. Redirecting means there is exactly one
    address for any given page and whatever the reader ends up looking at, the
    URL says so.

    Below the range redirects too rather than erroring. `?page=0` and
    `?page=banana` are a truncated link or a hand-edited address, not an attack;
    the useful answer is the start of the archive. The API stays strict about
    them — a client sending `page=0` really is malformed — but a person typing
    it into the address bar is just somebody who wants the first page.
  */
  const parsed = Number.parseInt(requested ?? '', 10);
  const valid = Number.isFinite(parsed) && parsed >= 1;

  // `requested !== undefined` guards the redirect against itself: with no
  // parameter at all this *is* the canonical URL already.
  if (requested !== undefined && (!valid || parsed === 1)) redirect(basePath as Route);

  const page = valid ? parsed : 1;
  const archive = await api.getEpisodePage(podcast.id, { page, limit: EPISODES_PER_PAGE });

  // Past the end. The API answers with the last real page, which is what tells
  // us where this URL should have pointed.
  if (archive.page !== page) redirect(`${basePath}?page=${archive.page}` as Route);

  if (archive.items.length === 0) {
    return (
      <p className="type-callout text-[var(--color-text-secondary)]">
        {t.t('podcast.noEpisodes')}
      </p>
    );
  }

  return (
    <>
      <div>
        {archive.items.map((episode) => (
          <EpisodeRow
            key={episode.id}
            episode={episode}
            fallbackArtwork={podcast.artworkUrl}
            podcastTitle={podcast.title}
            accentColor={podcast.accentColor}
            {...(tint ? { tint } : {})}
            requiresAccount={podcast.source === 'directory'}
          />
        ))}
      </div>

      <EpisodePager
        page={archive.page}
        pageCount={archive.pageCount}
        basePath={basePath}
        t={t}
      />
    </>
  );
}

/**
 * Ten rows' worth of held space.
 *
 * Sized to the real thing so the pager and the page footer do not jump when the
 * list lands — this is the only part of the screen that arrives late, and it is
 * most of the screen's height.
 */
function EpisodeListSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 py-2">
      {Array.from({ length: EPISODES_PER_PAGE }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <span className="h-14 w-14 shrink-0 rounded-[var(--radius-md)] bg-[var(--color-skeleton)]" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="block h-3 w-24 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
            <span className="block h-4 w-2/3 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
          </span>
        </div>
      ))}
    </div>
  );
}
