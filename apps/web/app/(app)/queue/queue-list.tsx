'use client';

import type { PlayableEpisode } from '@cue/core';
import { tintTextProps } from '@cue/design';
import { duration } from '@cue/motion';
import { AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { memo, useCallback } from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { useTransition } from '@/lib/motion';
import { usePlayerActions } from '@/lib/player/store';

/**
 * The draggable queue, split into its own module so it can be loaded on demand.
 *
 * This is the only part of the screen that needs `Reorder`, and `Reorder` is
 * the only thing in the whole web app that needs Motion's projection engine —
 * the machinery that measures elements and animates between layouts. Nothing
 * else animates layout: the mini→full player is deliberately one persistent
 * component driven by a single value rather than a shared-element transition.
 *
 * Imported statically, it landed in a chunk the bundler shared across every
 * route, so the home screen paid ~31KB gzipped for a drag handle it does not
 * have. Behind a dynamic import the cost falls on the two screens that reorder
 * something, which is where it belongs.
 */
export default function QueueList({ queue }: { queue: PlayableEpisode[] }) {
  const actions = usePlayerActions();

  /**
   * Stable across renders, and it has to be: `Reorder.Group` calls this on
   * every swap mid-drag. `usePlayerActions` hands back a module-level
   * constant, so the empty dependency list is honest — nothing captured here
   * can change identity.
   */
  const onReorder = useCallback((next: PlayableEpisode[]) => {
    actions.reorderQueue(next.map((item) => item.id));
  }, []);

  return (
    <Reorder.Group
      axis="y"
      values={queue}
      onReorder={onReorder}
      className="m-0 list-none p-0"
    >
      <AnimatePresence initial={false}>
        {queue.map((episode, index) => (
          <QueueRow key={episode.id} episode={episode} position={index + 1} />
        ))}
      </AnimatePresence>
    </Reorder.Group>
  );
}

/**
 * Memoized per row. A reorder only reshuffles array positions — the episode
 * objects themselves keep their references across swaps — so every row that
 * is not in hand skips its render entirely instead of paying for a drag it
 * has nothing to do with.
 */
const QueueRow = memo(function QueueRow({
  episode,
  position,
}: {
  episode: PlayableEpisode;
  position: number;
}) {
  const t = useTranslator();
  const actions = usePlayerActions();
  const controls = useDragControls();

  /**
   * How the *other* rows get out of the way while one is in hand.
   *
   * The drag itself is left alone under reduced motion — the finger is doing
   * that movement and stopping it would just break the feature. It is the rows
   * reflowing around it that becomes a jump instead of a glide.
   */
  const settle = useTransition('standard');

  const length = t.duration(episode.durationSec);

  return (
    <Reorder.Item
      value={episode}
      // Dragging is started by the handle, not the row: the row contains a
      // link and two buttons, and a whole-row drag makes every one of them
      // feel unreliable to click.
      dragListener={false}
      dragControls={controls}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
      className="flex items-center gap-3 border-b border-[var(--color-border)] py-3 last:border-b-0"
      whileDrag={{
        // Lifted off the page while it is in hand — the one place in the app a
        // shadow is right, because the thing genuinely is floating. This used
        // to point at `--elevation-3`, a token tokens.css never defined, so
        // the lift silently rendered as nothing. `--elevation-lg` exists; the
        // row finally leaves the page.
        boxShadow: 'var(--elevation-lg)',
        backgroundColor: 'var(--color-surface-raised)',
        cursor: 'grabbing',
      }}
    >
      <button
        type="button"
        onPointerDown={(event) => controls.start(event)}
        aria-label={t.t('queue.reorder', { title: episode.title })}
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

      <Artwork src={episode.artworkUrl} alt={episode.podcastTitle} size={44} />

      <div className="min-w-0 flex-1">
        <Link
          href={`/podcast/${episode.podcastId}` as Route}
          className="type-body-strong clamp-1 m-0 text-[var(--color-text-primary)] no-underline hover:underline"
        >
          {episode.title}
        </Link>
        <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
          {episode.podcastTitle}
          {length ? <span aria-hidden="true"> · </span> : null}
          {length}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void actions.play(episode)}
        className="type-caption shrink-0 cursor-pointer rounded-[var(--radius-sm)] border-none bg-transparent px-3 py-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        /* The show's colour, resolved against the theme rather than fixed to
           the dark one. Spread whole because the marker attribute and the
           values have to arrive together; absent when the show has no colour,
           which leaves the class above as the fallback. */
        {...tintTextProps(episode.accentColor)}
      >
        Play now
      </button>

      <button
        type="button"
        onClick={() => actions.removeFromQueue(episode.id)}
        aria-label={t.t('queue.removeTitle', { title: episode.title })}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-transform duration-[var(--duration-instant)] ease-standard active:scale-[0.94] motion-reduce:active:scale-100"
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
