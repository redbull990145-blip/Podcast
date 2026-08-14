'use client';

import { playableFromEpisode } from '@cue/core';
import type { Episode } from '@cue/types';
import { motion } from 'motion/react';
import { usePressScale, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';

/**
 * Queue an episode, or take it back out.
 *
 * One control rather than a menu of "play next" / "add to queue" / "remove".
 * Position within the queue is decided on the queue screen, by dragging, which
 * is both more direct than a menu item and the only place the order is
 * actually visible.
 */
export function QueueButton({
  episode,
  podcastTitle,
  podcastArtworkUrl,
  accentColor,
}: {
  episode: Episode;
  podcastTitle: string;
  podcastArtworkUrl: string | null;
  accentColor?: string | null;
}) {
  const state = usePlayerState();
  const actions = usePlayerActions();

  // Above the early return below, where they have to be: this component
  // renders nothing for the playing episode, so a hook read further down would
  // change the hook count the moment playback moved to this row.
  const press = usePressScale(0.9);
  const transition = useTransition('snappy');

  const queued = state.queue.some((item) => item.id === episode.id);
  // Queueing what is already playing is meaningless, so the control goes away
  // rather than sitting there doing nothing.
  const isCurrent = state.current?.id === episode.id;

  if (isCurrent) return null;

  return (
    <motion.button
      type="button"
      onClick={() => {
        if (queued) {
          actions.removeFromQueue(episode.id);
          return;
        }
        actions.enqueue(
          playableFromEpisode(episode, {
            title: podcastTitle,
            artworkUrl: podcastArtworkUrl,
            accentColor: accentColor ?? null,
          }),
        );
      }}
      aria-label={queued ? `Remove ${episode.title} from queue` : `Add ${episode.title} to queue`}
      aria-pressed={queued}
      whileTap={{ scale: press }}
      transition={transition}
      className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      style={queued ? { color: 'var(--color-accent-text)' } : undefined}
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* A list, with the last line becoming a tick once it is in. */}
        <path d="M4 7h11M4 12h11M4 17h7" />
        {queued ? <path d="M15 16.5 17.5 19l4.5-5" /> : <path d="M19 13v6M16 16h6" />}
      </svg>
    </motion.button>
  );
}
