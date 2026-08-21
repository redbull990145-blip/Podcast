'use client';

import { formatTimestamp, parseShareTime, playableFromEpisode } from '@cue/core';
import type { Episode } from '@cue/types';
import * as m from 'motion/react-m';
import { useSearchParams } from 'next/navigation';
import { useTranslator } from '@/components/i18n/locale-provider';
import { usePressScale, useTransition } from '@/lib/motion';
import { usePlayerActions } from '@/lib/player/store';

/**
 * "Somebody sent you this bit."
 *
 * A prompt rather than autoplay, and deliberately. Browsers refuse to start
 * audio without a gesture, so an auto-starting link would fail silently on most
 * arrivals — and even where it worked, a page that begins talking because a
 * link was opened is a page people close.
 *
 * It also has to survive being opened while something else is playing, which is
 * the ordinary case for a link tapped out of a chat. Nothing is interrupted
 * until the button is pressed.
 */
export function SharedTimestamp({
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
  const t = useTranslator();
  const params = useSearchParams();
  const actions = usePlayerActions();
  // Through the shared policy rather than a literal: if the reduced-motion cap
  // ever tightens, this callout follows the system instead of freezing at
  // whatever number was written here.
  const press = usePressScale(0.97);
  const transition = useTransition('responsive');

  const seconds = parseShareTime(params.get('t'));
  if (seconds === null) return null;

  // A link from a longer edit of the episode, or one somebody mangled. Better
  // to show nothing than to offer a jump past the end.
  if (episode.durationSec !== null && seconds >= episode.durationSec) return null;

  const playable = playableFromEpisode(episode, {
    title: podcastTitle,
    artworkUrl: podcastArtworkUrl,
    accentColor: accentColor ?? null,
  });

  const time = formatTimestamp(seconds);

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3">
      <p className="type-callout m-0 flex-1 text-[var(--color-text-secondary)]">
        {t.t('share.sharedFrom', { time })}
      </p>

      <m.button
        type="button"
        onClick={() => void actions.playAt(playable, seconds)}
        whileTap={{ scale: press }}
        transition={transition}
        className="type-body-strong min-h-11 cursor-pointer rounded-[var(--radius-md)] border-none px-4 text-[var(--color-text-on-accent)] transition-opacity hover:opacity-90"
        style={{ backgroundColor: tint ?? 'var(--color-accent)' }}
      >
        {t.t('share.playFrom', { time })}
      </m.button>
    </div>
  );
}
