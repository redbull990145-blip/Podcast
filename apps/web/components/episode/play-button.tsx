'use client';

import { playableFromEpisode } from '@cue/core';
import type { Episode } from '@cue/types';
import * as m from 'motion/react-m';
import { useRouter } from 'next/navigation';
import { useTranslator } from '@/components/i18n/locale-provider';
import { useHydrated } from '@/lib/hydrated';
import { usePressScale, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerSelector } from '@/lib/player/store';
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
  const t = useTranslator();
  const actions = usePlayerActions();
  const router = useRouter();
  const { isSignedIn, isLoading } = useSession();
  const press = usePressScale(0.9);
  const transition = useTransition('snappy');

  /**
   * Slices rather than the whole snapshot.
   *
   * The player emits on every position tick — several times a second while
   * anything plays — and `usePlayerState` would hand each of those to every
   * row on screen. All this button wants to know is "is it me, and is it
   * playing", so it subscribes to those two booleans directly: a selector that
   * answers in a primitive only wakes the row whose answer actually changed,
   * and the rest of the list stays quiet while one episode plays.
   */
  const isCurrent = usePlayerSelector((s) => s.current?.id === episode.id);
  const playing = usePlayerSelector((s) => s.status === 'playing');

  /**
   * Gated, and *known* to be gated.
   *
   * Three conditions, and the last two are the bug this fixes. `isSignedIn` is
   * false in two completely different situations — nobody is signed in, and
   * nobody has looked yet — and treating them the same made every gated button
   * render as "Sign in to play" until the session query landed. On the podcast
   * page that query resolves after the first paint, so a signed-in listener got
   * a row of dead play buttons that routed them to a sign-in page they did not
   * need, and React logged a hydration mismatch on every load because the
   * server had rendered the locked label and the client had not.
   *
   * `useHydrated` is what makes the *first* client render agree with the
   * server's. Gating on `isLoading` alone is not enough: it fixes the signed-in
   * case and reintroduces the mismatch for a signed-out one, because the server
   * always renders pending while the client may already know the answer.
   *
   * Unknown therefore reads as unlocked. That is the safe direction — this is a
   * product gate rather than a security one (the audio streams from the
   * publisher's own CDN and was never ours to withhold), so the cost of being
   * briefly wrong is a play that works, not a leak.
   */
  const hydrated = useHydrated();
  const locked = requiresAccount && hydrated && !isLoading && !isSignedIn;

  const isPlaying = isCurrent && playing;

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
      /* The title is a parameter rather than a template literal, so the words
         around it can sit wherever the language puts them. Built in English
         here, it read half in the reader's language and half in ours — the same
         fault `QueueRow` fixed for its own play control. */
      aria-label={t.t(
        locked
          ? 'episode.signInToPlayTitle'
          : isPlaying
            ? 'episode.pauseTitle'
            : 'episode.playTitle',
        { title: episode.title },
      )}
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
