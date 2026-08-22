'use client';

import type { PlayableEpisode } from '@cue/core';
import { useTranslator } from '@/components/i18n/locale-provider';
import dynamic from 'next/dynamic';
import { Artwork } from '@/components/media/artwork';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';
import { useSession } from '@/lib/session';

/**
 * The reorderable list arrives separately.
 *
 * It carries Motion's projection engine — see `queue-list.tsx` — which is
 * otherwise loaded on every route in the app for the benefit of two. The list
 * needs the browser anyway (it is a drag interaction and the queue lives in
 * client state), so there is nothing to server-render here and no content
 * lost by deferring it.
 */
const QueueList = dynamic(() => import('./queue-list'), {
  ssr: false,
  // Holds the row heights so the page does not jolt when the list arrives.
  loading: () => <div className="min-h-40" aria-hidden="true" />,
});

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
            className="type-callout cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-4 py-2 text-[var(--color-text-secondary)] transition-[transform,border-color,color] duration-[var(--duration-instant)] ease-standard hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] active:scale-[0.96] motion-reduce:active:scale-100"
          >
            Clear
          </button>
        ) : null}
      </header>

      {state.current ? <NowPlaying episode={state.current} /> : null}

      {queue.length === 0 ? (
        <Empty signedIn={isSignedIn} loading={isLoading} playing={state.current !== null} />
      ) : (
        <QueueList queue={queue} />
      )}
    </div>
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
