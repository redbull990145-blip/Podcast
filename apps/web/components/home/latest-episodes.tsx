import type { Episode, Podcast } from '@cue/types';
import type { Route } from 'next';
import Link from 'next/link';
import { Artwork } from '@/components/media/artwork';
import { PlayButton } from '@/components/episode/play-button';
import { PagedRail } from '@/components/ui/paged-rail';
import { catalogue } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';

/** How many shows to ask, and how many picks to keep. */
const SOURCES = 10;
/** Six in the shelf, three on screen — the same shape as Recommended above. */
const PICKS = 6;
const PER_PAGE = 3;

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
 * Three **equal** columns. The first used to be 1.4× the others, on the theory
 * that the eye has to be told where to start — but covers are square, so a
 * wider first column is also a *taller* one, and the caption under it dropped
 * to a different baseline from the two beside it. What that reads as is not
 * emphasis, it is a grid that has gone wrong: one enormous cover and two
 * ordinary ones, with their titles refusing to line up. Sequence already says
 * where to start, and every cover on Home is now the same size as its
 * neighbours.
 */
export async function LatestEpisodes({ podcasts }: { podcasts: Podcast[] }) {
  const picks = await latestPerShow(podcasts);
  if (picks.length === 0) return null;

  const t = await getTranslator();

  return (
    <section aria-labelledby="latest-heading" className="mb-14">
      {/*
        Rendered here, on the server, and handed to a client component to page.

        The rows are React elements by the time `PagedRail` sees them, so the
        feed reading, the `allSettled`, and every `await` above stay server-side
        — the only thing that crosses the boundary is which three are visible.
      */}
      <PagedRail
        headingId="latest-heading"
        label={t.t('home.latest')}
        note={t.t('home.latestNote')}
        action={{ href: '/library', label: t.t('home.viewMore') }}
        perPage={PER_PAGE}
        items={picks.map(({ episode, podcast }) => (
          <li key={episode.id}>
            <LatestPick episode={episode} podcast={podcast} />
          </li>
        ))}
      />
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
    sources.map((podcast) => catalogue.getEpisodes(podcast.id, { limit: 1 })),
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

  /*
    `sm`, matching the grid above. These two have to switch on the same
    breakpoint: the grid going to two columns while this was still a
    72px-thumbnail row left each cell laid out as a phone row inside half a
    desktop column, with the cover stranded beside a column of white space.
  */
  return (
    <article className="flex items-center gap-4 sm:block">
      <Link
        href={`/podcast/${podcast.id}` as Route}
        aria-label={podcast.title}
        className="block w-[72px] shrink-0 no-underline transition-opacity hover:opacity-90 sm:mb-3.5 sm:w-full"
      >
        <Artwork
          src={episode.artworkUrl ?? podcast.artworkUrl}
          alt=""
          size={200}
          responsive
          sizes="(min-width: 1024px) 22vw, (min-width: 640px) 44vw, 72px"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/podcast/${podcast.id}` as Route}
          className="type-overline clamp-1 block text-[var(--color-accent-text)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
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
      <div className="shrink-0 sm:hidden">
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

      {/* Shaped like the real grid above, breakpoint for breakpoint — a
          placeholder reserving a different amount of space than the content it
          stands in for is a layout shift with extra steps. */}
      <div className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* `PER_PAGE`, not `PICKS`: the shelf holds six and shows three, and
            what has to be reserved is the space three of them take. */}
        {Array.from({ length: PER_PAGE }, (_, index) => (
          <div key={index} className="flex items-center gap-4 sm:block">
            <div className="aspect-square w-[72px] shrink-0 rounded-[var(--radius-md)] bg-[var(--color-skeleton)] sm:mb-3.5 sm:w-full" />
            <div className="min-w-0 flex-1">
              <span className="block h-3 w-24 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
              <span className="mt-2 block h-4 w-2/3 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
              <span className="mt-2 block h-3 w-20 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
            </div>
            {/* The control takes real width on a phone, so its absence would
                make every title look longer than it will be. */}
            <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--color-skeleton)] sm:hidden" />
          </div>
        ))}
      </div>
    </section>
  );
}
