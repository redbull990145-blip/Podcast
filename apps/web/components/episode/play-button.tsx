'use client';

import { playableFromEpisode } from '@cue/core';
import type { Episode } from '@cue/types';
import { motion } from 'motion/react';
import { usePressScale, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';

/**
 * Play an episode from a list.
 *
 * The control reflects three states — idle, this-one-is-playing, and
 * this-one-is-paused — because a list where every row shows the same play
 * triangle gives no clue which episode you are actually listening to.
 */
export function PlayButton({
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
  const press = usePressScale(0.9);
  const transition = useTransition('snappy');

  const isCurrent = state.current?.id === episode.id;
  const isPlaying = isCurrent && state.status === 'playing';

  const playable = playableFromEpisode(episode, {
    title: podcastTitle,
    artworkUrl: podcastArtworkUrl,
    accentColor: accentColor ?? null,
  });

  return (
    <motion.button
      type="button"
      onClick={() => {
        // Already the current episode: toggle rather than reload it, which
        // would restart buffering and lose the position.
        if (isCurrent) {
          actions.toggle();
          return;
        }
        void actions.play(playable);
      }}
      aria-label={
        isPlaying ? `Pause ${episode.title}` : `Play ${episode.title}`
      }
      whileTap={{ scale: press }}
      transition={transition}
      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--color-border)] bg-transparent text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]"
      style={
        isCurrent
          ? { borderColor: 'transparent', backgroundColor: tint ?? 'var(--color-accent-muted)' }
          : undefined
      }
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        style={isCurrent ? { color: 'var(--color-text-on-accent)' } : undefined}
      >
        {isPlaying ? (
          <path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" />
        ) : (
          <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
        )}
      </svg>
    </motion.button>
  );
}
