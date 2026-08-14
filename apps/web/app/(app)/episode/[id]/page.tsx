import { ApiClientError } from '@cue/api-client';
import { getTranslator } from '@/lib/i18n';
import { deriveTint } from '@cue/design';
import type { Metadata } from 'next';
import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AiPanel } from '@/components/ai/ai-panel';
import { EpisodeActions } from '@/components/episode/episode-actions';
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

  const tint = podcast.accentColor ? deriveTint(podcast.accentColor, 'dark') : null;
  const artwork = episode.artworkUrl ?? podcast.artworkUrl;
  const t = await getTranslator();
  const length = t.duration(episode.durationSec);

  return (
    <div className="relative mx-auto w-full max-w-[var(--measure-content)] px-5 py-8 md:px-10 md:py-12">
      {tint ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[300px] sm:h-[380px]"
          style={{
            background: `linear-gradient(to bottom, ${tint.wash} 0%, transparent 100%)`,
            zIndex: 0,
          }}
        />
      ) : null}

      <div className="relative">
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

            <div className="mt-5">
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

        <ShowNotes html={episode.descriptionHtml} text={episode.description} />

        {/* Above the transcript, not below it: this is the short version, and
            burying it under two thousand lines of prose would make it findable
            only by people who did not need it. */}
        <section className="mt-10">
          <AiPanel
            episode={episode}
            podcastTitle={podcast.title}
            podcastArtworkUrl={podcast.artworkUrl}
            accentColor={podcast.accentColor}
          />
        </section>

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
