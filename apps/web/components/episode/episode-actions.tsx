'use client';

import { playableFromEpisode } from '@cue/core';
import type { Episode } from '@cue/types';
import { motion } from 'motion/react';
import { ShareButton } from '@/components/episode/share-button';
import { AddToPlaylist } from '@/components/playlist/add-to-playlist';
import { usePressScale, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';

/**
 * Play and queue, on the episode's own page.
 *
 * A full-width labelled control rather than the icon button a list row uses:
 * on a page dedicated to one episode there is exactly one thing you came to
 * do, and it should say what it is.
 */
export function EpisodeActions({
  episode,
  podcastTitle,
  podcastArtworkUrl,
  accentColor,
  tint,
}: {
  episode: Episode;
  podcastTitle: string;
  podcastArtworkUrl: string | null;
  accentColor?: string | null;
  tint?: string | undefined;
}) {
  const state = usePlayerState();
  const actions = usePlayerActions();

  // Read once, up here: the queue button below is conditionally rendered, so
  // reading them inside it would make the hook count depend on what is
  // playing.
  const press = usePressScale(0.97);
  const transition = useTransition('responsive');

  const isCurrent = state.current?.id === episode.id;
  const isPlaying = isCurrent && state.status === 'playing';
  const queued = state.queue.some((item) => item.id === episode.id);

  const playable = playableFromEpisode(episode, {
    title: podcastTitle,
    artworkUrl: podcastArtworkUrl,
    accentColor: accentColor ?? null,
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <motion.button
        type="button"
        onClick={() => {
          if (isCurrent) {
            actions.toggle();
            return;
          }
          void actions.play(playable);
        }}
        whileTap={{ scale: press }}
        transition={transition}
        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border-none px-5 text-[var(--color-text-on-accent)]"
        style={{ backgroundColor: tint ?? 'var(--color-accent)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {isPlaying ? (
            <path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" />
          ) : (
            <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
          )}
        </svg>

        <span className="type-body-strong">
          {isPlaying ? 'Pause' : isCurrent ? 'Resume' : 'Play'}
        </span>
      </motion.button>

      {/* Queueing what is already playing is meaningless, so the control goes
          away rather than sitting there doing nothing. */}
      {isCurrent ? null : (
        <motion.button
          type="button"
          onClick={() => {
            if (queued) {
              actions.removeFromQueue(episode.id);
              return;
            }
            actions.enqueue(playable);
          }}
          aria-pressed={queued}
          whileTap={{ scale: press }}
          transition={transition}
          className="type-body min-h-11 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border-strong)] bg-transparent px-5 text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          {queued ? 'In your queue' : 'Add to queue'}
        </motion.button>
      )}

      {/* Collecting and passing on, side by side. Both are things you do
          *about* an episode rather than to the player, which is why they sit
          after the transport controls rather than among them. */}
      <AddToPlaylist episodeId={episode.id} />
      <ShareButton episodeId={episode.id} />
    </div>
  );
}
