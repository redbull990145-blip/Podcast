'use client';

import type { PlayableEpisode } from '@cue/core';
import { useTranslator } from '@/components/i18n/locale-provider';
import { deriveTint } from '@cue/design';
import { duration } from '@cue/motion';
import { AnimatePresence, Reorder, useDragControls } from 'motion/react';
import Link from 'next/link';
import type { Route } from 'next';
import { Artwork } from '@/components/media/artwork';
import { useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';
import { useSession } from '@/lib/session';

/**
 * What plays next.
 *
 * The order is the whole point of the screen, so it is edited directly by
 * dragging rather than through a menu of "move up" / "move down". Fractional
 * sort keys are what make that one write per drag instead of renumbering the
 * whole queue.
 */
export function QueueClient() {
  const t = useTranslator();
  const { isSignedIn, isLoading } = useSession();
  const state = usePlayerState();
  const actions = usePlayerActions();

  const queue = state.queue;

  return (
    <div className="mx-auto max-w-[var(--measure-wide)] px-5 py-10 md:px-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="type-display m-0 text-[var(--color-text-primary)]">Queue</h1>
          <p className="type-callout mt-2 mb-0 text-[var(--color-text-secondary)]">
            {queue.length === 0
              ? 'Nothing lined up.'
              : t.t('queue.after', { count: queue.length })}
          </p>
        </div>

        {queue.length > 0 ? (
          <button
            type="button"
            onClick={() => actions.clearQueue()}
            className="type-callout cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-4 py-2 text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)]"
          >
            Clear
          </button>
        ) : null}
      </header>

      {state.current ? <NowPlaying episode={state.current} /> : null}

      {queue.length === 0 ? (
        <Empty signedIn={isSignedIn} loading={isLoading} playing={state.current !== null} />
      ) : (
        <Reorder.Group
          axis="y"
          values={queue}
          onReorder={(next: PlayableEpisode[]) => {
            actions.reorderQueue(next.map((item) => item.id));
          }}
          className="m-0 list-none p-0"
        >
          <AnimatePresence initial={false}>
            {queue.map((episode, index) => (
              <QueueRow key={episode.id} episode={episode} position={index + 1} />
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}
    </div>
  );
}

function QueueRow({ episode, position }: { episode: PlayableEpisode; position: number }) {
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

  const tint = episode.accentColor ? deriveTint(episode.accentColor, 'dark') : null;
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
        // shadow is right, because the thing genuinely is floating.
        boxShadow: 'var(--elevation-3)',
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
        style={tint ? { color: tint.text } : undefined}
      >
        Play now
      </button>

      <button
        type="button"
        onClick={() => actions.removeFromQueue(episode.id)}
        aria-label={t.t('queue.removeTitle', { title: episode.title })}
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

/** The episode the queue is queued *behind*, for context. */
function NowPlaying({ episode }: { episode: PlayableEpisode }) {
  return (
    <section className="mb-8">
      <h2 className="type-overline m-0 mb-3 text-[var(--color-text-tertiary)]">PLAYING</h2>

      <div className="flex items-center gap-3">
        <Artwork src={episode.artworkUrl} alt={episode.podcastTitle} size={44} />
        <div className="min-w-0">
          <p className="type-body-strong clamp-1 m-0 text-[var(--color-text-primary)]">
            {episode.title}
          </p>
          <p className="type-caption mt-0.5 mb-0 text-[var(--color-text-tertiary)]">
            {episode.podcastTitle}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Empty states.
 *
 * Signed-out, signed-in-with-nothing, and nothing-playing-at-all are three
 * different situations with three different next steps, and collapsing them
 * into one "your queue is empty" helps nobody.
 */
function Empty({
  signedIn,
  loading,
  playing,
}: {
  signedIn: boolean;
  loading: boolean;
  playing: boolean;
}) {
  if (loading) return null;

  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
      <p className="type-title3 m-0 text-[var(--color-text-primary)]">
        {playing ? 'Nothing after this one' : 'Nothing lined up'}
      </p>

      <p className="type-callout mx-auto mt-2 mb-0 max-w-[var(--measure-prose)] text-[var(--color-text-secondary)]">
        {playing
          ? 'Add an episode from any show and it will play when this one finishes.'
          : 'Queue episodes from a show and they will play back to back.'}
      </p>

      {!signedIn ? (
        <p className="type-caption mt-4 mb-0 text-[var(--color-text-tertiary)]">
          {/* Honest about the limit rather than hiding the queue behind auth:
              it works signed-out, it just does not follow you. */}
          Your queue works without an account — signing in is what carries it to
          your other devices.
        </p>
      ) : null}
    </div>
  );
}
