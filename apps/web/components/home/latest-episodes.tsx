import type { Episode, Podcast } from '@cue/types';
import type { Route } from 'next';
import Link from 'next/link';
import { Artwork } from '@/components/media/artwork';
import { PlayButton } from '@/components/episode/play-button';
import { SectionHeader } from '@/components/ui/section-header';
import { api } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';

/** How many shows to ask, and how many picks to keep. */
const SOURCES = 8;
const PICKS = 3;

type Pick = { episode: Episode; podcast: Podcast };

/**
 * Something to press play on.
 *
 * Home used to be entirely covers. Every one of them was a link to a show
 * page, from which you picked an episode, from which you played — three
 * navigations before any audio, on a screen whose entire purpose is starting
 * some. For a signed-out visitor, who has no Continue Listening either, there
 * was no play control anywhere on the front page.
 *
 * **One episode per show, newest first.** Strict recency across the catalogue
 * would let a daily news show take every row on any day it published twice,
 * which is how a "latest" rail turns into one publisher's feed. Taking each
 * show's newest and then ordering those keeps the section a survey of the
 * catalogue, which is what a front page owes a stranger.
 *
 * **Three, presented large, rather than six in a list.** The catalogue grid
 * below already answers "what else is there", at thumbnail size, for the whole
 * library. Repeating that question immediately above it in slightly bigger
 * rows was two surveys stacked on each other; what this section is for is
 * making three specific episodes look worth an hour of someone's evening, and
 * that takes a cover you can actually see.
 *
 * The first column is wider than the other two. Three equal columns is a
 * table, and the eye has to be told where to start.
 */
export async function LatestEpisodes({ podcasts }: { podcasts: Podcast[] }) {
  const picks = await latestPerShow(podcasts);
  if (picks.length === 0) return null;

  const t = await getTranslator();

  return (
    <section aria-labelledby="latest-heading" className="mb-14">
      <SectionHeader
        id="latest-heading"
        label={t.t('home.latest')}
        note={t.t('home.latestNote')}
      />

      <ul className="m-0 grid list-none grid-cols-1 gap-x-5 gap-y-6 p-0 md:grid-cols-[1.4fr_1fr_1fr]">
        {picks.map(({ episode, podcast }) => (
          <li key={episode.id}>
            <LatestPick episode={episode} podcast={podcast} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The newest episode of each of the most active shows.
 *
 * `allSettled`, not `all`: one publisher's feed failing to read must cost its
 * own place and nothing else. With `all` a single rejection would take the
 * whole section down — and this section sits above the catalogue, so it would
 * look like Home itself had broken.
 */
async function latestPerShow(podcasts: Podcast[]): Promise<Pick[]> {
  const sources = podcasts.slice(0, SOURCES);

  const results = await Promise.allSettled(
    sources.map((podcast) => api.getEpisodes(podcast.id, { limit: 1 })),
  );

  const picks: Pick[] = [];

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;

    const episode = result.value.items[0];
    const podcast = sources[index];
    if (!episode || !podcast) return;

    picks.push({ episode, podcast });
  });

  return picks
    .sort(
      (a, b) =>
        Date.parse(b.episode.publishedAt) - Date.parse(a.episode.publishedAt),
    )
    .slice(0, PICKS);
}

/**
 * One episode, attributed to its show.
 *
 * Cover, then the show's name as an eyebrow, then the title. The show leads
 * because three picks from three different publishers are unreadable without
 * it — but it leads *above* the title rather than under it, so the title keeps
 * the position the eye lands on.
 *
 * On a phone the same content is a row: a square cover at column width would
 * be most of the screen, three times over.
 */
async function LatestPick({ episode, podcast }: Pick) {
  const t = await getTranslator();
  const duration = t.duration(episode.durationSec);
  const date = t.episodeDate(episode.publishedAt);

  return (
    <article className="flex items-center gap-4 md:block">
      <Link
        href={`/podcast/${podcast.id}` as Route}
        aria-label={podcast.title}
        className="block w-[72px] shrink-0 no-underline md:mb-3.5 md:w-full"
      >
        <Artwork
          src={episode.artworkUrl ?? podcast.artworkUrl}
          alt=""
          size={260}
          responsive
          sizes="(min-width: 768px) 340px, 72px"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/podcast/${podcast.id}` as Route}
          className="type-overline clamp-1 block text-[var(--color-accent-text)] no-underline"
        >
          {podcast.title}
        </Link>

        {/* The title is the link rather than the whole card: the row also
            carries a play control, and a wrapping anchor would turn every
            near-miss on play into a navigation. */}
        <h3 className="type-title3 mt-1 mb-0">
          <Link
            href={`/episode/${episode.id}` as Route}
            className="clamp-2 text-[var(--color-text-primary)] no-underline hover:underline"
          >
            {episode.title}
          </Link>
        </h3>

        <p className="type-caption mt-1.5 mb-0 text-[var(--color-text-tertiary)]">
          <time dateTime={episode.publishedAt}>{date}</time>
          {/* An unknown duration renders as nothing rather than "0 min", and
              the separator leaves with it so there is no dangling bullet. */}
          {duration ? <span aria-hidden="true"> · </span> : null}
          {duration}
        </p>
      </div>

      {/* On a phone the control sits at the end of the row; on a desktop it
          would be a lone circle under a paragraph, and the cover above is
          already a link into the show. */}
      <div className="shrink-0 md:hidden">
        <PlayButton
          episode={episode}
          podcastTitle={podcast.title}
          podcastArtworkUrl={podcast.artworkUrl}
          accentColor={podcast.accentColor}
        />
      </div>
    </article>
  );
}

/**
 * What stands in while the episodes are fetched.
 *
 * The section is streamed, so the catalogue below it paints without waiting on
 * eight feed reads. That only helps if the space is already claimed — a block
 * that appears late and pushes the grid down is worse than one that was always
 * slow, because the reader has by then started aiming at something.
 */
export function LatestEpisodesSkeleton() {
  return (
    <section aria-hidden="true" className="mb-14">
      {/* The heading's footprint, at the size the heading actually is — a
          20px title over a 13px note, not a hairline. */}
      <div className="mb-4">
        <span className="block h-5 w-40 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
        <span className="mt-2 block h-3 w-52 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
      </div>

      <div className="grid grid-cols-1 gap-x-5 gap-y-6 md:grid-cols-[1.4fr_1fr_1fr]">
        {Array.from({ length: PICKS }, (_, index) => (
          <div key={index} className="flex items-center gap-4 md:block">
            <div className="aspect-square w-[72px] shrink-0 rounded-[var(--radius-md)] bg-[var(--color-skeleton)] md:mb-3.5 md:w-full" />
            <div className="min-w-0 flex-1">
              <span className="block h-3 w-24 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
              <span className="mt-2 block h-4 w-2/3 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
              <span className="mt-2 block h-3 w-20 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
            </div>
            {/* The control takes real width on a phone, so its absence would
                make every title look longer than it will be. */}
            <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--color-skeleton)] md:hidden" />
          </div>
        ))}
      </div>
    </section>
  );
}
