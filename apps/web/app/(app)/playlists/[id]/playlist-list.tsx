'use client';

import { playableFromQueueEntry } from '@cue/core';
import { tintTextProps } from '@cue/design';
import { duration } from '@cue/motion';
import type { PlaylistEntry } from '@cue/types';
import { AnimatePresence, Reorder, useDragControls } from 'motion/react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { useTransition } from '@/lib/motion';
import { usePlayerActions } from '@/lib/player/store';

/**
 * The draggable playlist, loaded on demand.
 *
 * Split out for the same reason as the queue's list — see `queue-list.tsx`.
 * `Reorder` is the app's only user of Motion's projection engine, and imported
 * statically it was billed to every route rather than the two that reorder
 * anything.
 */
export default function PlaylistList({
  order,
  onReorder,
  onRemove,
}: {
  order: PlaylistEntry[];
  onReorder: (next: PlaylistEntry[]) => void;
  onRemove: (episodeId: string) => void;
}) {
  return (
    <Reorder.Group
      axis="y"
      values={order}
      onReorder={onReorder}
      className="m-0 list-none p-0"
    >
      <AnimatePresence initial={false}>
        {order.map((entry, index) => (
          <PlaylistRow
            key={entry.episode.id}
            entry={entry}
            position={index + 1}
            onRemove={() => onRemove(entry.episode.id)}
          />
        ))}
      </AnimatePresence>
    </Reorder.Group>
  );
}

function PlaylistRow({
  entry,
  position,
  onRemove,
}: {
  entry: PlaylistEntry;
  position: number;
  onRemove: () => void;
}) {
  const t = useTranslator();
  const actions = usePlayerActions();
  const controls = useDragControls();

  /**
   * How the *other* rows move while one is in hand.
   *
   * The drag itself is left alone under reduced motion — a finger is doing that
   * movement, and stopping it would break the feature rather than calm it. It
   * is the reflow around it that becomes a jump instead of a glide.
   */
  const settle = useTransition('standard');

  const playable = playableFromQueueEntry(entry);
  const length = t.duration(entry.episode.durationSec);

  return (
    <Reorder.Item
      value={entry}
      // Started from the handle, not the row: the row holds a link and two
      // buttons, and a whole-row drag makes every one of them feel unreliable.
      dragListener={false}
      dragControls={controls}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
      className="flex items-center gap-3 border-b border-[var(--color-border)] py-3 last:border-b-0"
      whileDrag={{
        boxShadow: 'var(--elevation-3)',
        backgroundColor: 'var(--color-surface-raised)',
        cursor: 'grabbing',
      }}
    >
      <button
        type="button"
        onPointerDown={(event) => controls.start(event)}
        aria-label={t.t('queue.reorder', { title: entry.episode.title })}
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

      <Artwork
        src={entry.episode.artworkUrl ?? entry.podcastArtworkUrl}
        alt={entry.podcastTitle}
        size={44}
      />

      <div className="min-w-0 flex-1">
        <Link
          href={`/episode/${entry.episode.id}` as Route}
          className="type-body-strong clamp-1 m-0 text-[var(--color-text-primary)] no-underline hover:underline"
        >
          {entry.episode.title}
        </Link>
        <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
          {entry.podcastTitle}
          {length ? <span aria-hidden="true"> · </span> : null}
          {length}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void actions.play(playable)}
        className="type-caption shrink-0 cursor-pointer rounded-[var(--radius-sm)] border-none bg-transparent px-3 py-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        {...tintTextProps(entry.accentColor)}
      >
        {t.t('episode.play')}
      </button>

      <button
        type="button"
        onClick={onRemove}
        aria-label={t.t('playlists.removeTitle', { title: entry.episode.title })}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
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
}
