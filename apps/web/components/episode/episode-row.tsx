import { getTranslator } from '@/lib/i18n';
import type { Episode } from '@cue/types';
import type { Route } from 'next';
import Link from 'next/link';
import { Artwork } from '@/components/media/artwork';
import { PlayButton } from '@/components/episode/play-button';
import { QueueButton } from '@/components/episode/queue-button';
import { ListeningMark } from '@/components/episode/listening-state';

type EpisodeRowProps = {
  episode: Episode;
  /** Falls back to the show's cover when the episode has none of its own. */
  fallbackArtwork: string | null;
  podcastTitle: string;
  accentColor?: string | null;
  tint?: string | undefined;
  /** Show came from the directory; the play control decides what that means. */
  requiresAccount?: boolean;
};

/**
 * One episode in a list.
 *
 * The hierarchy is deliberate and does most of the work: date and duration sit
 * above the title in a quiet overline, the title is the only strong element,
 * and the description is dimmed and clamped. A listener scanning a list is
 * asking "what is this and is it new?" — the layout answers in that order.
 */
export async function EpisodeRow({
  episode,
  fallbackArtwork,
  podcastTitle,
  accentColor,
  tint,
  requiresAccount = false,
}: EpisodeRowProps) {
  // A server component, so it takes the server translator. The client hook
  // cannot be called here — and TypeScript does not model that boundary, so
  // this only surfaced as a runtime error in the browser.
  const t = await getTranslator();
  const duration = t.duration(episode.durationSec);
  const date = t.episodeDate(episode.publishedAt);

  return (
    <article className="cue-episode-row flex items-center gap-4 border-b border-[var(--color-border)] px-1 py-4 last:border-b-0">
      {/* The cover is the anchor for the listening mark, so it needs a
          positioning context of its own — `Artwork` sets the radius, and
          `rounded-[inherit]` inside the mark picks it up rather than restating
          a number that scales with size. */}
      <div className="relative shrink-0 rounded-[var(--radius-sm)]">
        <Artwork
          src={episode.artworkUrl ?? fallbackArtwork}
          alt={podcastTitle}
          size={56}
        />
        <ListeningMark
          episodeId={episode.id}
          accentColor={accentColor ?? null}
          durationSec={episode.durationSec}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="type-overline mb-1 text-[var(--color-text-tertiary)]">
          <time dateTime={episode.publishedAt}>{date}</time>
          {/* An unknown duration renders as nothing rather than "0 min" — the
              separator goes with it, so there is no dangling bullet. */}
          {duration ? <span aria-hidden="true"> · </span> : null}
          {duration}
        </div>

        {/* The title is the link, not the whole row: the row also holds two
            buttons, and a wrapping anchor would make every play tap a
            navigation on anything but a perfect hit. */}
        <h3 className="type-body-strong m-0">
          <Link
            href={`/episode/${episode.id}` as Route}
            className="clamp-2 text-[var(--color-text-primary)] no-underline hover:underline"
          >
            {episode.title}
          </Link>
        </h3>

        {episode.description ? (
          // Capped to a readable measure. Without it, descriptions run to
          // ~140 characters on a wide viewport — twice the length at which
          // prose stops being scannable.
          <p className="type-callout clamp-2 mt-1 mb-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
            {episode.description}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center">
        <QueueButton
          episode={episode}
          podcastTitle={podcastTitle}
          podcastArtworkUrl={fallbackArtwork}
          accentColor={accentColor ?? null}
        />

        <PlayButton
          episode={episode}
          podcastTitle={podcastTitle}
          podcastArtworkUrl={fallbackArtwork}
          accentColor={accentColor ?? null}
          tint={tint}
          requiresAccount={requiresAccount}
        />
      </div>
    </article>
  );
}
