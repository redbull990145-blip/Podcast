import type { Podcast } from '@cue/types';
import Link from 'next/link';
import { Artwork } from '@/components/media/artwork';

/**
 * A show in a grid.
 *
 * Artwork-led: the cover is the thing people recognise, and the text under it
 * is support. No card chrome — no border, no background, no shadow — because a
 * grid of framed boxes reads as a dashboard, and the artwork already supplies
 * every edge the eye needs.
 */
export function PodcastTile({ podcast, priority = false }: { podcast: Podcast; priority?: boolean }) {
  return (
    <Link
      href={`/podcast/${podcast.id}` as never}
      className="group block no-underline"
    >
      {/* A 2px lift on hover — enough to say "this is the thing you are
          pointing at" without the grid appearing to breathe. Gated on
          `motion-reduce` because it is travel, and unlike Motion's inline
          transforms a CSS class the media query can actually reach. */}
      <div className="transition-transform duration-[var(--duration-fast)] ease-standard group-hover:-translate-y-0.5 group-active:translate-y-0 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        <Artwork
          src={podcast.artworkUrl}
          alt={podcast.title}
          size={200}
          priority={priority}
          responsive
          // The grid this sits in runs 2 / 3 / 4 / 5 columns. Widest cell at
          // each step, so the browser never picks a candidate too small.
          sizes="(min-width: 1280px) 260px, (min-width: 1024px) 300px, (min-width: 640px) 33vw, 45vw"
        />
      </div>

      <h3 className="type-body-strong clamp-2 mt-3 mb-0 text-[var(--color-text-primary)]">
        {podcast.title}
      </h3>

      {podcast.author ? (
        <p className="type-callout clamp-1 mt-0.5 mb-0 text-[var(--color-text-secondary)]">
          {podcast.author}
        </p>
      ) : null}
    </Link>
  );
}
