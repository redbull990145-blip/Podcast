'use client';

import { playableFromEpisode } from '@cue/core';
import type { Episode } from '@cue/types';
import * as m from 'motion/react-m';
import { useRouter } from 'next/navigation';
import { usePressScale, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';
import { useSession } from '@/lib/session';

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
  requiresAccount = false,
}: {
  episode: Episode;
  podcastTitle: string;
  podcastArtworkUrl: string | null;
  accentColor?: string | null;
  tint?: string | undefined;
  /**
   * This show came from the directory, so playing it needs an account.
   *
   * Whether there *is* an account is decided here rather than by the caller,
   * because the callers are server components — the podcast page knows which
   * shows are gated and cannot know who is looking at them, and passing a
   * ready-made `locked` from there gated the show for everybody, signed in or
   * not. The two halves of the question are answered where each is knowable.
   *
   * A product gate, not a security one: the audio streams from the publisher's
   * own CDN and was never ours to withhold. So it lives in the control rather
   * than pretending to be enforced somewhere it cannot be.
   */
  requiresAccount?: boolean;
}) {
  const state = usePlayerState();
  const actions = usePlayerActions();
  const router = useRouter();
  const { isSignedIn } = useSession();
  const press = usePressScale(0.9);
  const transition = useTransition('snappy');

  const locked = requiresAccount && !isSignedIn;

  const isCurrent = state.current?.id === episode.id;
  const isPlaying = isCurrent && state.status === 'playing';

  const playable = playableFromEpisode(episode, {
    title: podcastTitle,
    artworkUrl: podcastArtworkUrl,
    accentColor: accentColor ?? null,
  });

  return (
    <m.button
      type="button"
      onClick={() => {
        if (locked) {
          router.push('/signin');
          return;
        }
        // Already the current episode: toggle rather than reload it, which
        // would restart buffering and lose the position.
        if (isCurrent) {
          actions.toggle();
          return;
        }
        void actions.play(playable);
      }}
      aria-label={
        locked
          ? `Sign in to play ${episode.title}`
          : isPlaying
            ? `Pause ${episode.title}`
            : `Play ${episode.title}`
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
    </m.button>
  );
}
