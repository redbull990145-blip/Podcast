'use client';

import { duration } from '@cue/motion';
import { AnimatePresence, useMotionValue } from 'motion/react';
import * as m from 'motion/react-m';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Artwork } from '@/components/media/artwork';
import {
  readPosition,
  usePlayerActions,
  usePlayerSelector,
} from '@/lib/player/store';
import { useTransition } from '@/lib/motion';

/**
 * How long before the end the next episode is announced, in seconds.
 *
 * Long enough to read a title and reach a button, short enough that it is
 * clearly part of *this* episode ending rather than a banner that lives on the
 * screen. Ten seconds is also about the length of the outro music most shows
 * end on, so it tends to appear exactly when the content has finished.
 */
const LEAD_SEC = 10;

/**
 * What is about to play, and when.
 *
 * The queue advances on its own when an episode ends — it always has — and
 * until now it did so silently. The first a listener knew about it was a
 * different voice, which is disorienting in a way that is hard to place: you
 * cannot tell whether the show ended, whether you mis-tapped, or whether the
 * app decided something on your behalf.
 *
 * So this says what is coming, shows it, and counts down to it. The countdown
 * is the load-bearing part: an announcement with no clock is a notification,
 * and one with a visible clock is an *offer* — it tells you how long you have
 * to do something else about it, which is what makes the automatic behaviour
 * feel like it is on your side.
 *
 * **The bar is driven by the audio clock, not by a timer.** A `setInterval`
 * counting to ten would drift away from the thing it is describing the moment
 * playback stalls, is paused, or is played at 1.5× — and this is precisely the
 * ten seconds where a listener is watching a bar and listening to audio at the
 * same time, so any disagreement between them is visible. Reading the playhead
 * every frame means the bar pauses when the audio pauses, for free.
 */
export function UpNext() {
  const t = useTranslator();
  const actions = usePlayerActions();

  // Selected primitives rather than the whole snapshot. The interesting fact
  // here — "the playhead has entered the last ten seconds" — is a boolean that
  // flips once per episode; the snapshot it is computed from re-emits several
  // times a second, and a card that is not yet on screen has no business
  // re-rendering for any of it. The countdown itself reads the live clock
  // through `readPosition`, so no position value ever needs to be state.
  const next = usePlayerSelector((s) => s.queue[0] ?? null);
  const currentId = usePlayerSelector((s) => s.current?.id ?? null);
  const durationSec = usePlayerSelector((s) => s.durationSec);
  const playing = usePlayerSelector((s) => s.status === 'playing');
  const inLead = usePlayerSelector((s) => {
    const d = s.durationSec;
    return (
      d !== null &&
      s.positionSec >= d - LEAD_SEC &&
      // Past the end is the moment *after* this card's job, and `ended` fires a
      // beat later than the arithmetic does. Without this the card flickers back
      // for a frame as the next episode loads at position 0 with the old
      // duration still on state.
      s.positionSec <= d
    );
  });

  /**
   * Dismissed for this episode.
   *
   * Keyed by episode id rather than a bare boolean, so closing the card on one
   * episode does not silence it for the rest of the queue — which, in a queue,
   * is every remaining announcement.
   */
  const [dismissed, setDismissed] = useState<string | null>(null);

  const due =
    next !== null && currentId !== null && inLead && playing && dismissed !== currentId;

  /**
   * The countdown, as a value nothing re-renders to move.
   *
   * Same rule the scrubber follows: a bar that moves every frame must not be
   * React state, or the player subtree re-renders sixty times a second for the
   * last ten seconds of every episode.
   */
  const progress = useMotionValue(0);
  const [seconds, setSeconds] = useState(LEAD_SEC);

  useEffect(() => {
    if (!due || durationSec === null) return;

    let frame = 0;
    let lastLabel = 0;

    const tick = (timestamp: number) => {
      const left = Math.max(0, durationSec - readPosition());

      // Drains rather than fills: the bar *is* the time remaining, so it should
      // be shortening. A filling bar at the end of an episode reads as loading.
      progress.set(Math.max(0, Math.min(1, left / LEAD_SEC)));

      if (timestamp - lastLabel >= 250) {
        lastLabel = timestamp;
        /*
          Clamped to the lead, not just to zero.

          The playhead is read through the smoothing model, and for one frame
          after a seek that model can still be anchored to where the playhead
          *was* — so the very first sample after the card appears is occasionally
          a fraction of a second rather than ten. Unclamped, that rendered "Up
          next in 1 second" for a frame and then jumped back to ten, which reads
          as the countdown running backwards at the exact moment somebody starts
          watching it. The bar is clamped for the same reason a line below.
        */
        setSeconds(Math.max(0, Math.min(LEAD_SEC, Math.ceil(left))));
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [due, durationSec, progress]);

  /**
   * Forget the dismissal once it can no longer apply.
   *
   * Held on the *previous* episode's id, so it has to be cleared when the
   * episode changes or a listener who dismissed one card would find the id
   * reused if the same episode came round again later in the queue.
   */
  const lastEpisode = useRef<string | null>(null);
  useEffect(() => {
    if (currentId !== lastEpisode.current) {
      lastEpisode.current = currentId;
      setDismissed(null);
    }
  }, [currentId]);

  // The advance is sprung and the fade is not — springs move things, tweens
  // fade things, and opacity riding an overshooting spring clips at the
  // compositor. Reduced motion flows through the shared policy from here.
  const settle = useTransition('standard');
  const cardTransition = { ...settle, opacity: { duration: duration.base / 1000 } };

  if (!next) return null;

  return (
    <div
      /*
        Above the player bar, and clear of the tab bar underneath it on a phone.

        The offsets match the gutter the shell already reserves for the same two
        pieces of chrome — 104px on desktop for the 84px bar, and the taller
        stack on mobile where the tab bar sits below the mini player. Hardcoding
        a smaller number here would float the card over the transport it is
        describing.
      */
      className="pointer-events-none fixed inset-x-0 bottom-[calc(148px+env(safe-area-inset-bottom))] z-30 px-4 md:bottom-[100px] md:ps-[calc(var(--measure-sidebar)+24px)] md:pe-6"
    >
      {/* It announces itself; it leaves the way it arrived rather than
          vanishing mid-frame the instant the episode flips. */}
      <AnimatePresence>
        {due ? (
          <m.article
            // Rises as it arrives rather than fading in place: it is a new object
            // entering the screen from the direction of the player it belongs to.
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={cardTransition}
        className="pointer-events-auto relative ms-auto w-full max-w-[420px] overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface-overlay)] [box-shadow:var(--elevation-lg)]"
      >
        <div className="flex items-center gap-3 p-3">
          <Artwork
            src={next.artworkUrl ?? null}
            alt=""
            size={44}
          />

          <div className="min-w-0 flex-1">
            <p className="type-overline m-0 text-[var(--color-accent-text)]">
              {t.t('player.upNextIn', { seconds })}
            </p>
            <h3 className="type-body-strong clamp-1 m-0 mt-0.5">
              <Link
                href={`/episode/${next.id}` as Route}
                className="text-[var(--color-text-primary)] no-underline"
              >
                {next.title}
              </Link>
            </h3>
            <p className="type-caption clamp-1 m-0 text-[var(--color-text-tertiary)]">
              {next.podcastTitle}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Skips the wait rather than duplicating it. Someone who has read
                the card and wants it now should not have to sit through the
                outro to get there. */}
            <button
              type="button"
              onClick={() => void actions.next()}
              className="flex h-8 cursor-pointer items-center rounded-full border-0 bg-[var(--color-ink)] px-3 type-caption text-[var(--color-text-on-ink)] transition-[transform,opacity] duration-[var(--duration-instant)] ease-standard hover:opacity-90 active:scale-[0.96] motion-reduce:active:scale-100"
            >
              {t.t('player.playNow')}
            </button>

            {/* Hides the card, and deliberately does not stop the queue: the
                queue is what the listener lined up, and a close button on a
                notice is not where you would expect to unqueue something. */}
            <button
              type="button"
              onClick={() => setDismissed(currentId)}
              aria-label={t.t('common.dismiss')}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[var(--color-text-tertiary)] transition-[transform,background-color,color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] active:scale-[0.94] motion-reduce:active:scale-100"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/*
          The countdown, along the floor of the card.

          On the edge rather than inside the padding, so it reads as a property
          of the whole card — the card itself running out — rather than as a
          progress bar for one of the controls above it.
        */}
        <div aria-hidden="true" className="h-[3px] w-full bg-[var(--color-border)]">
          <m.div
            className="h-full origin-left bg-[var(--color-accent)]"
            style={{ scaleX: progress }}
          />
        </div>
          </m.article>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
