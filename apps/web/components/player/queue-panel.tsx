'use client';

import type { PlayableEpisode } from '@cue/core';
import { icon } from '@cue/design';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import { usePressScale, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerSelector } from '@/lib/player/store';

/**
 * What is coming next, inside the player.
 *
 * The queue button used to be a link to `/queue`, which meant the answer to
 * "what's after this?" was a *navigation* — closing the player, leaving
 * whatever page you were on, and arriving somewhere you then had to come back
 * from. That is a page's worth of ceremony for a question people ask while
 * glancing at the screen, and it is why the expanded player felt like it ended
 * at the transport controls.
 *
 * So it is a panel in the sheet, sharing the column the transcript uses. One
 * column, two things you might want beside the artwork, and the same spring
 * opening it either way — see `player.tsx`'s `columns` value. Two permanent
 * columns would have meant a third of the sheet standing empty whenever the
 * queue was short, which is most of the time.
 *
 * `/queue` still exists and still does more than this: reordering, the played
 * history, bulk clearing. This answers the glance; that page is for the edit.
 */
export function QueuePanel({
  className = '',
  style,
}: {
  className?: string;
  /** Pinned width while the column animates open — see the call site. */
  style?: React.CSSProperties;
}) {
  const t = useTranslator();
  /*
    Two selectors rather than the whole snapshot, per `usePlayerSelector`'s
    contract. The queue array is a stable reference between mutations — the
    machine replaces it only when it actually changes — so comparing it by
    identity is exactly right and costs one check per position tick instead of
    a re-render of every row.
  */
  const queue = usePlayerSelector((state) => state.queue);
  const current = usePlayerSelector((state) => state.current);

  return (
    /*
      Bounded, and sitting at the top of the column rather than filling it.

      The column this shares with the transcript is half the window, which for a
      transcript is a reading measure and for a list of three rows is a title
      stretched across nine hundred pixels with its show name orphaned at the
      far end. A queue is a short list; it should read as a panel of that size,
      not as a column that failed to fill.

      `max-w` rather than a fixed width so it still fits when the column is
      narrower than the cap — on a phone this is the whole screen.
    */
    <div
      className={['flex min-h-0 w-full max-w-[560px] flex-col', className].join(' ')}
      style={style}
    >
      <div className="mb-2 flex shrink-0 items-baseline justify-between gap-3">
        <h3 className="type-title3 m-0 text-[var(--color-text-primary)]">
          {t.t('player.upNext')}
        </h3>

        {/* The way to the full page, kept as a quiet link rather than dropped.
            Reordering and history live there, and hiding the door to them
            because the panel exists would make the panel a downgrade for
            anyone who used the page. */}
        <Link
          href={'/queue' as Route}
          className="type-caption shrink-0 text-[var(--color-text-tertiary)] no-underline underline-offset-4 transition-colors hover:text-[var(--color-text-primary)] hover:underline"
        >
          {t.t('player.queueManage')}
        </Link>
      </div>

      {/*
        The episode playing right now, pinned above the list.

        `state.queue` deliberately excludes it — the queue is what is *next* —
        but a panel headed "Up next" that never shows what it is next *to* asks
        the reader to hold the current episode in their head while they read a
        list of successors. It is marked rather than merely first, so the
        boundary between now and later is visible.
      */}
      {current ? (
        <div className="mb-2 shrink-0">
          <QueueRow episode={current} nowPlaying />
        </div>
      ) : null}

      {queue.length === 0 ? (
        <p className="type-callout mt-1 mb-0 text-[var(--color-text-tertiary)]">
          {t.t('queue.emptyBody')}
        </p>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
          <AnimatePresence initial={false}>
            {queue.map((episode, index) => (
              <m.li
                key={episode.id}
                layout
                /*
                  Height and margin collapse together on the way out, so the
                  rows below close the gap rather than jumping up into it. A
                  removed row that simply disappears makes the list look like
                  it re-rendered; one that collapses makes it look like the row
                  left.

                  Opacity is tweened while the collapse is sprung — the motion
                  package's rule, and the reason a fade does not flicker here.
                */
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <QueueRow episode={episode} position={index + 1} />
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

/**
 * One episode in the queue.
 *
 * The whole row is the control that plays it — a 44px target across the full
 * column rather than a play button someone has to find — and the only separate
 * control is the one that removes it, which must not be the thing your thumb
 * lands on by accident.
 */
function QueueRow({
  episode,
  position,
  nowPlaying = false,
}: {
  episode: PlayableEpisode;
  /** Its place in the queue, 1-based. Absent for the current episode. */
  position?: number;
  nowPlaying?: boolean;
}) {
  const t = useTranslator();
  const { play, removeFromQueue } = usePlayerActions();
  const press = usePressScale(0.98);
  const transition = useTransition('responsive');

  return (
    <div
      className={[
        'group flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2',
        nowPlaying ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]',
      ].join(' ')}
    >
      <m.button
        type="button"
        onClick={() => void play(episode)}
        whileTap={{ scale: press }}
        transition={transition}
        aria-label={t.t('home.resume', { title: episode.title })}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-start"
      >
        <span className="relative shrink-0">
          <Artwork src={episode.artworkUrl} alt="" size={40} />
          {/* The position, over the corner of the cover. On the cover rather
              than in its own column because a number column is 24px of the
              panel's width spent on something only the first few rows use. */}
          {position !== undefined ? (
            <span className="absolute -end-1 -bottom-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-surface-overlay)] px-1 type-caption text-[var(--color-text-tertiary)]">
              {position}
            </span>
          ) : null}
        </span>

        <span className="min-w-0 flex-1">
          {nowPlaying ? (
            <span className="type-overline clamp-1 block text-[var(--color-accent-text)]">
              {t.t('player.nowPlayingLabel')}
            </span>
          ) : null}
          <span className="type-body-strong clamp-2 block text-[var(--color-text-primary)]">
            {episode.title}
          </span>
          <span className="type-caption clamp-1 block text-[var(--color-text-tertiary)]">
            {episode.podcastTitle}
          </span>
        </span>
      </m.button>

      {/* Only for queued episodes: "remove" applied to what is playing is a
          different action with a different name, and offering it here would
          make one glyph mean two things. */}
      {nowPlaying ? null : (
        <m.button
          type="button"
          onClick={() => removeFromQueue(episode.id)}
          whileTap={{ scale: press }}
          transition={transition}
          aria-label={t.t('queue.remove')}
          /*
            Revealed on hover, but never hidden from the keyboard or from
            touch. `opacity-0` alone would leave a focusable control invisible
            to anyone tabbing through, and on a touch screen there is no hover
            to reveal it with — so it is opaque by default below `md`.
          */
          className={[
            'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full',
            'border-0 bg-transparent text-[var(--color-text-tertiary)]',
            'transition-[opacity,color] hover:text-[var(--color-text-primary)]',
            'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
          ].join(' ')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d={icon.close} />
          </svg>
        </m.button>
      )}
    </div>
  );
}
