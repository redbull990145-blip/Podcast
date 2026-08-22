'use client';

import type { PlaylistPodcastEntry } from '@cue/types';
import { duration } from '@cue/motion';
import { AnimatePresence, Reorder, useDragControls } from 'motion/react';
import type { Route } from 'next';
import Link from 'next/link';
import { memo } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { useTransition } from '@/lib/motion';

/**
 * The draggable list of shows, loaded on demand.
 *
 * Split out for the same reason as the queue's and the episode list's —
 * `Reorder` carries Motion's projection engine, and imported statically it is
 * billed to every route rather than the three that reorder anything.
 *
 * A near-twin of `playlist-list.tsx` and deliberately not shared with it. The
 * two rows have different content (no duration, no play button — a show is not
 * playable), different links, and different labels; a single component
 * parameterised over all of that would be a component whose body is one long
 * conditional, which is harder to read than two honest lists.
 */
export default function PlaylistShowList({
  order,
  onReorder,
  onRemove,
}: {
  order: PlaylistPodcastEntry[];
  onReorder: (next: PlaylistPodcastEntry[]) => void;
  onRemove: (podcastId: string) => void;
}) {
  return (
    <Reorder.Group axis="y" values={order} onReorder={onReorder} className="m-0 list-none p-0">
      <AnimatePresence initial={false}>
        {order.map((entry, index) => (
          <ShowRow
            key={entry.podcast.id}
            entry={entry}
            position={index + 1}
            // The id, not a closure: a fresh arrow per render would hand every
            // memoised row new props and quietly switch the memo off.
            podcastId={entry.podcast.id}
            onRemove={onRemove}
          />
        ))}
      </AnimatePresence>
    </Reorder.Group>
  );
}

/**
 * Memoised because a drag re-renders this list on every swap — rows whose show
 * did not change have no reason to re-render with it.
 */
const ShowRow = memo(function ShowRow({
  entry,
  position,
  podcastId,
  onRemove,
}: {
  entry: PlaylistPodcastEntry;
  position: number;
  podcastId: string;
  onRemove: (podcastId: string) => void;
}) {
  const t = useTranslator();
  const controls = useDragControls();

  /**
   * How the *other* rows move while one is in hand.
   *
   * The drag itself is left alone under reduced motion — a finger is doing that
   * movement, and stopping it would break the feature rather than calm it. It
   * is the reflow around it that becomes a jump instead of a glide.
   */
  const settle = useTransition('standard');
  const { podcast } = entry;

  return (
    <Reorder.Item
      value={entry}
      // Started from the handle, not the row: the row holds a link and a
      // button, and a whole-row drag makes both feel unreliable.
      dragListener={false}
      dragControls={controls}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
      className="flex items-center gap-3 border-b border-[var(--color-border)] py-3 last:border-b-0"
      whileDrag={{
        boxShadow: 'var(--elevation-lg)',
        backgroundColor: 'var(--color-surface-raised)',
        cursor: 'grabbing',
      }}
    >
      <button
        type="button"
        onPointerDown={(event) => controls.start(event)}
        aria-label={t.t('playlists.reorderShow', { title: podcast.title })}
        className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center border-none bg-transparent text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <path d="M9 6.5h1.5V8H9zM13.5 6.5H15V8h-1.5zM9 11.25h1.5v1.5H9zM13.5 11.25H15v1.5h-1.5zM9 16h1.5v1.5H9zM13.5 16H15v1.5h-1.5z" />
        </svg>
      </button>

      <span
        className="type-caption w-5 shrink-0 text-end text-[var(--color-text-tertiary)]"
        aria-hidden="true"
      >
        {position}
      </span>

      <Artwork src={podcast.artworkUrl} alt={podcast.title} size={44} />

      <div className="min-w-0 flex-1">
        <Link
          href={`/podcast/${podcast.id}` as Route}
          className="type-body-strong clamp-1 m-0 text-[var(--color-text-primary)] no-underline hover:underline"
        >
          {podcast.title}
        </Link>
        <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
          {/* A feed that has never been fetched has no count yet — null, not
              zero. Joining the parts rather than nesting conditionals is what
              keeps the separator from surviving the thing it separates. */}
          {[
            podcast.author,
            podcast.episodeCount !== null && podcast.episodeCount > 0
              ? t.t('podcast.episodeCount', { count: podcast.episodeCount })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onRemove(podcastId)}
        aria-label={t.t('playlists.removeShowTitle', { title: podcast.title })}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-[var(--color-text-tertiary)] transition-[transform,background-color,color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:scale-[0.94] motion-reduce:active:scale-100"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </Reorder.Item>
  );
});
