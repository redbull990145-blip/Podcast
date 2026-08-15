import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiClientError } from '@cue/api-client';
import { getTranslator } from '@/lib/i18n';
import { deriveTint } from '@cue/design';
import { Artwork } from '@/components/media/artwork';
import { ShowNotice } from '@/components/podcast/show-notice';
import { SubscribeButton } from '@/components/podcast/subscribe-button';
import { EpisodeRow } from '@/components/episode/episode-row';
import { api } from '@/lib/api';

export const revalidate = 300;

type Params = { params: Promise<{ id: string }> };

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

export default async function PodcastPage({ params }: Params) {
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
  const episodes = await api.getEpisodes(id, { limit: 30 });

  /**
   * The show's own colour, lifted from its artwork.
   *
   * This is where the product gets to be colourful without inventing a palette:
   * the wash behind the header belongs to this podcast and no other, and it is
   * rendered server-side so it is present in the first paint rather than
   * arriving after an image decodes.
   */
  const tint = podcast.accentColor ? deriveTint(podcast.accentColor, 'dark') : null;
  const t = await getTranslator();

  return (
    <div className="relative">
      {/*
        This wrapper exists so the wash can sit outside the width-capped column.

        It used to be a child of that column, where `inset-x-0` means "the
        column", not "the page" — so on any window wider than the content cap
        the colour stopped dead at the text with plain background either side of
        it. Light coming off a cover does not stop in a straight line. Out here
        it fills the content area edge to edge, and because that area is already
        inset by the sidebar it does so without needing to know the sidebar
        exists — which a `100vw` box would have got wrong in the other direction.
      */}
      {tint ? (
        <div
          aria-hidden="true"
          // Sized to the header rather than to a fixed pixel height. At 420px
          // the wash covered half a phone viewport and was still strong behind
          // the description — the colour has to end where the header does, on
          // every screen, or it stops reading as light off the cover and starts
          // reading as a coloured page.
          className="pointer-events-none absolute inset-x-0 top-0 h-[300px] sm:h-[380px]"
          style={{
            background: `linear-gradient(to bottom, ${tint.wash} 0%, transparent 100%)`,
            zIndex: 0,
          }}
        />
      ) : null}

      <div className="relative mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end">
        <Artwork src={podcast.artworkUrl} alt={podcast.title} size={192} priority />

        <div className="min-w-0">
          {/* The heading comes first and carries its own weight. Metadata sits
              below it, where it belongs — a label above a title is a caption
              pretending to be a hierarchy. */}
          <h1 className="type-title1 mt-0 mb-0 text-[var(--color-text-primary)]">
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

          <div className="mt-5">
            <SubscribeButton
              podcastId={podcast.id}
              {...(tint ? { tint: tint.fill } : {})}
            />
          </div>
        </div>
      </header>

      <ShowNotice
        podcastId={podcast.id}
        source={podcast.source}
        {...(tint ? { tint: tint.fill } : {})}
      />

      {podcast.description ? (
        <p className="type-body mb-10 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
          {podcast.description}
        </p>
      ) : null}

      <section aria-label={t.t('podcast.episodes')}>
        <h2 className="type-title3 mb-2 text-[var(--color-text-primary)]">{t.t('podcast.episodes')}</h2>

        {episodes.items.length === 0 ? (
          <p className="type-callout text-[var(--color-text-secondary)]">
            No episodes have been published yet.
          </p>
        ) : (
          <div>
            {episodes.items.map((episode) => (
              <EpisodeRow
                key={episode.id}
                episode={episode}
                fallbackArtwork={podcast.artworkUrl}
                podcastTitle={podcast.title}
                accentColor={podcast.accentColor}
                {...(tint ? { tint: tint.fill } : {})}
                requiresAccount={podcast.source === 'directory'}
              />
            ))}
          </div>
        )}

        {/* Paging beyond the first page arrives with the virtualized list in
            the performance phase — 30 rows do not need windowing, and adding
            it now would be machinery without a measurement behind it. */}
        {episodes.nextCursor ? (
          <p className="type-caption mt-6 text-[var(--color-text-tertiary)]">
            Showing the {episodes.items.length} most recent episodes.
          </p>
        ) : null}
      </section>
      </div>
    </div>
  );
}
