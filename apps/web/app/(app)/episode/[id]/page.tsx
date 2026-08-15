import { ApiClientError } from '@cue/api-client';
import { getTranslator } from '@/lib/i18n';
import { deriveTint } from '@cue/design';
import type { Metadata } from 'next';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AiPanel } from '@/components/ai/ai-panel';
import { EpisodeActions } from '@/components/episode/episode-actions';
import { EpisodeTint } from '@/components/episode/episode-tint';
import { SharedTimestamp } from '@/components/episode/shared-timestamp';
import { ShowNotes } from '@/components/episode/show-notes';
import { TranscriptPanel } from '@/components/transcript/transcript-panel';
import { Artwork } from '@/components/media/artwork';
import { api } from '@/lib/api';

export const revalidate = 300;

type Params = { params: Promise<{ id: string }> };

/**
 * An episode is the unit people actually share — a link to "this specific
 * conversation", not to the show. So this page carries the episode's own
 * title, summary and artwork into the document head, and is rendered on the
 * server so a crawler or a preview card sees real content.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;

  try {
    const { episode } = await api.getEpisode(id);
    const { podcast } = await api.getPodcast(episode.podcastId);
    const summary = episode.description?.slice(0, 160) ?? undefined;

    return {
      title: episode.title,
      description: summary,
      openGraph: {
        title: episode.title,
        description: summary,
        images: episode.artworkUrl ?? podcast.artworkUrl ? [(episode.artworkUrl ?? podcast.artworkUrl)!] : undefined,
        // `article` rather than `website`: this is a dated piece by an author,
        // which is what the type is for and what a preview card reads.
        type: 'article',
        publishedTime: episode.publishedAt,
      },
    };
  } catch {
    return { title: 'Episode' };
  }
}

export default async function EpisodePage({ params }: Params) {
  const { id } = await params;

  let episode: Awaited<ReturnType<typeof api.getEpisode>>['episode'];
  try {
    ({ episode } = await api.getEpisode(id));
  } catch (error) {
    // A missing episode is a 404, not a 500 — publishers delete episodes, and
    // a stale shared link should say so with the right status.
    if (error instanceof ApiClientError && error.code === 'not_found') notFound();
    throw error;
  }

  const { podcast } = await api.getPodcast(episode.podcastId);

  /**
   * The episode's own colour, falling back to the show's.
   *
   * The order matters and used to be the other way round, which produced the
   * obvious wrong thing: a Planet Money episode with a yellow Caribbean cover
   * sat under the show's dark green, because the show is green and nothing
   * asked the episode. Episode covers vary far more than shows do — this
   * catalogue has 2,804 distinct episode images across six shows — so the
   * episode is the better answer whenever it has one.
   *
   * Null until the episode has been played once, since the colour is extracted
   * on demand rather than for every episode of every feed. `EpisodeTint` below
   * fills that gap from the client without making this page wait on an image.
   */
  const tint = episode.accentColor
    ? deriveTint(episode.accentColor, 'dark')
    : podcast.accentColor
      ? deriveTint(podcast.accentColor, 'dark')
      : null;

  const artwork = episode.artworkUrl ?? podcast.artworkUrl;
  const t = await getTranslator();
  const length = t.duration(episode.durationSec);

  return (
    <div className="relative">
      {/*
        The wash lives out here, not inside the column below.

        Inside it, `inset-x-0` means the width of the text rather than the width
        of the page, so on any window wider than the content cap the colour
        stopped in a hard vertical line with plain background beside it. Out
        here it fills the content area edge to edge — and since that area is
        already inset by the sidebar, it does so without having to know the
        sidebar is there.
      */}
      <EpisodeTint
        episodeId={episode.id}
        initialColor={episode.accentColor ?? podcast.accentColor}
      />

      <div className="relative mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
        <header className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start">
          <Artwork src={artwork} alt={podcast.title} size={192} priority />

          <div className="min-w-0">
            {/* The show name is a link, not an eyebrow: it is the way back, and
                the heading below carries its own weight without a label. */}
            <Link
              href={`/podcast/${podcast.id}` as Route}
              className="type-callout text-[var(--color-text-secondary)] no-underline hover:underline"
              style={tint ? { color: tint.text } : undefined}
            >
              {podcast.title}
            </Link>

            <h1 className="type-title1 mt-2 mb-0 text-[var(--color-text-primary)]">
              {episode.title}
            </h1>

            <p className="type-caption mt-3 mb-0 text-[var(--color-text-tertiary)]">
              <time dateTime={episode.publishedAt}>
                {t.episodeDate(episode.publishedAt)}
              </time>
              {length ? <span aria-hidden="true"> · </span> : null}
              {length}
              {episode.seasonNumber !== null && episode.episodeNumber !== null ? (
                <span>
                  <span aria-hidden="true"> · </span>
                  {`S${episode.seasonNumber} E${episode.episodeNumber}`}
                </span>
              ) : null}
            </p>

            {/* A shared link arrives with `?t=`, which is a search param, and
                reading one bails this statically-rendered page out of its
                shell unless it sits behind its own boundary. Suspense keeps
                the rest of the page prerendered. */}
            <div className="mt-5">
              <Suspense fallback={null}>
                <SharedTimestamp
                  episode={episode}
                  podcastTitle={podcast.title}
                  podcastArtworkUrl={podcast.artworkUrl}
                  accentColor={podcast.accentColor}
                  {...(tint ? { tint: tint.fill } : {})}
                />
              </Suspense>

              <EpisodeActions
                episode={episode}
                podcastTitle={podcast.title}
                podcastArtworkUrl={podcast.artworkUrl}
                accentColor={podcast.accentColor}
                {...(tint ? { tint: tint.fill } : {})}
              />
            </div>
          </div>
        </header>

        {/*
          Notes and the summary side by side, once there is room for both.

          Show notes are capped at a reading measure and always will be — a line
          past about eighty characters makes the eye lose its place coming back.
          That cap used to leave half a wide screen empty, which read as a page
          that had not finished loading. Filling it with something worth reading
          is the fix; stretching the paragraphs to the window is not.

          The summary is the right neighbour because the two answer the same
          question at different lengths — what is this episode about — so a
          reader can take whichever one they have time for without scrolling
          past the other. Below `xl` they stack, notes first.
        */}
        <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,var(--measure-prose))_minmax(0,1fr)]">
          <ShowNotes html={episode.descriptionHtml} text={episode.description} />

          <section className="xl:sticky xl:top-8">
            <AiPanel
              episode={episode}
              podcastTitle={podcast.title}
              podcastArtworkUrl={podcast.artworkUrl}
              accentColor={podcast.accentColor}
            />
          </section>
        </div>

        {episode.transcriptUrl ? (
          <section className="mt-10">
            <h2 className="type-title3 mt-0 mb-4 text-[var(--color-text-primary)]">
              {t.t('transcript.title')}
            </h2>
            {/* The publisher's own, read in place. It used to link out, which
                made the one thing a transcript is *for* — following along and
                jumping to what you half-remember — someone else's page. */}
            <TranscriptPanel
              episode={episode}
              podcastTitle={podcast.title}
              podcastArtworkUrl={podcast.artworkUrl}
              accentColor={podcast.accentColor}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
