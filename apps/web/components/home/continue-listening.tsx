'use client';

import { queryKeys } from '@cue/api-client';
import { formatTimestamp } from '@cue/core';
import { playableFromQueueEntry } from '@cue/core';
import type { Translator } from '@cue/i18n';
import { useTranslator } from '@/components/i18n/locale-provider';
import { colorVarStyle, deriveTint, tintedScheme } from '@cue/design';
import type { ContinueEntry } from '@cue/types';
import { useQuery } from '@tanstack/react-query';
import { duration } from '@cue/motion';
import { animate, AnimatePresence, useMotionValue, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Artwork } from '@/components/media/artwork';
import { api } from '@/lib/api';
import { usePressScale, useTransition } from '@/lib/motion';
import { useFrameLoop } from '@/lib/player/frame-clock';
import { continueListeningEntries, type ResumeEntry } from '@/lib/player/continue-listening';
import { readPosition, usePlayerActions, usePlayerSelector } from '@/lib/player/store';
import { useSession } from '@/lib/session';
import { isLightNow, useThemeChoice } from '@/lib/theme';

/**
 * Pick up where you left off.
 *
 * This leads Home because it is the answer to why someone opened the app. A
 * catalogue grid answers "what exists"; almost nobody arrives asking that.
 * They arrive half way through something.
 *
 * Deliberately **not** a carousel of peers. The episode you touched most
 * recently gets a hero — a 220px cover, the title at page-title size, and the
 * two controls that actually apply to a half-finished episode — and the rest
 * get cards a third of the size. The hierarchy *is* the recommendation: giving
 * four episodes identical framing makes the reader redo the ranking the data
 * already did.
 *
 * Absent entirely when there is nothing in progress. A section header above an
 * empty rail is chrome advertising a feature you have not reached.
 */
export function ContinueListening() {
  const t = useTranslator();
  const { isSignedIn, isLoading: sessionLoading } = useSession();

  const { data, isPending } = useQuery({
    queryKey: queryKeys.library.continue(),
    queryFn: () => api.getContinue(4),
    enabled: isSignedIn,
    // Position moves constantly while listening, and this is the one screen
    // where a stale figure is visible as a progress bar in the wrong place.
    staleTime: 30_000,
  });

  // Identity follows the same stable snapshot as the mini/full player. A
  // progress write or a slow history response must never choose what is playing.
  const current = usePlayerSelector((state) => state.current);
  const liveDurationSec = usePlayerSelector((state) => state.durationSec);
  const { lead, rest } = continueListeningEntries(data?.items ?? [], current, liveDurationSec);

  /*
    Reserve the space before knowing whether anything goes in it.

    This section is client-rendered above a server-rendered page, so for a
    signed-in listener it used to arrive a beat after everything else and shove
    the whole catalogue down the screen — reliably, on every single visit, and
    at exactly the moment someone had picked a cover to click. The most
    expensive layout shift in the app was on its most visited route.

    Only for people who might actually have an entry. An anonymous visitor can
    never have one, so holding a hero's worth of empty space above their
    catalogue would be a permanent hole in the page in exchange for nothing.
    While the session is still resolving the answer is not yet known, so the
    placeholder stands: guessing "signed out" there is how the shift comes back
    for exactly the people it was hurting.
  */
  if (!lead && (sessionLoading || (isSignedIn && isPending))) {
    return <ContinueSkeleton />;
  }

  if (!lead) return null;

  return (
    <>
      <section aria-labelledby="continue-heading" className="mb-12">
        <h2 id="continue-heading" className="sr-only">
          {t.t('home.continue')}
        </h2>
        <ResumeHero entry={lead} />
      </section>

      {rest.length > 0 ? (
        <section aria-labelledby="also-heading" className="mb-14">
          <h2
            id="also-heading"
            className="type-title2 mt-0 mb-4 text-[var(--color-text-primary)]"
          >
            {t.t('home.alsoInProgress')}
          </h2>

          {/*
            A scroller on a phone and a grid on a desktop, from one list.

            Three cards do not fit across 390px and never will, so the phone
            gets the one shape that keeps them at a readable size — snap points,
            so a swipe lands on a card rather than between two. Above `md` the
            room exists and a scroller would be hiding content behind a gesture
            nobody has a reason to make.
          */}
          <ul className="-mx-5 flex snap-x snap-mandatory list-none gap-3 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0">
            {rest.map((entry) => (
              <li
                key={entry.episode.id}
                className="w-[248px] shrink-0 snap-start md:w-auto"
              >
                <ProgressCard entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * The hero's footprint, and nothing else.
 *
 * Just the hero: the cards below it are optional even for someone with history,
 * so reserving three cards' worth would trade one shift for another in the
 * opposite direction. The hero is the part that is there whenever the section
 * is there at all.
 */
function ContinueSkeleton() {
  return (
    <section aria-hidden="true" className="mb-12">
      <div className="-mx-5 bg-[var(--color-surface)] px-5 py-7 md:mx-0 md:rounded-[var(--radius-lg)] md:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-8">
          <div className="h-[92px] w-[92px] shrink-0 rounded-[var(--radius-md)] bg-[var(--color-skeleton)] md:h-[220px] md:w-[220px]" />
          <div className="min-w-0 flex-1">
            <span className="block h-[11px] w-40 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
            <span className="mt-4 block h-7 w-3/4 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
            <span className="mt-2 block h-4 w-32 rounded-[var(--radius-xs)] bg-[var(--color-skeleton)]" />
            <span className="mt-6 block h-[5px] w-full max-w-[480px] rounded-full bg-[var(--color-skeleton)]" />
            <span className="mt-6 block h-11 w-44 rounded-full bg-[var(--color-skeleton)]" />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * How much is left, and how far along — the two facts that decide "now?".
 *
 * The translator is a parameter because this is a plain function, not a
 * component, and a hook cannot be called from one. Passing it in is also what
 * keeps this testable without a React tree.
 */
function remainingOf(
  entry: ResumeEntry,
  t: Translator,
): { left: string | null; fraction: number } {
  const total = entry.durationSec ?? entry.episode.durationSec;
  if (total === null || total <= 0) return { left: null, fraction: 0 };

  const remaining = Math.max(0, total - entry.positionSec);
  return {
    left: t.duration(remaining),
    fraction: Math.min(1, Math.max(0, entry.positionSec / total)),
  };
}

/**
 * The one episode you are most likely to want.
 *
 * A band rather than a card on a phone — full width, hairlines top and bottom,
 * no corners — because a rounded card inset from both edges of a 390px screen
 * spends thirty pixels of the narrowest layout in the app on decoration. On a
 * desktop the room exists and the panel earns its corners.
 */
function ResumeHero({ entry }: { entry: ResumeEntry }) {
  const t = useTranslator();
  const { play, playAt, toggle } = usePlayerActions();
  const { left, fraction } = remainingOf(entry, t);

  /*
    Whether this hero is describing the episode that is playing right now.

    Two selectors rather than one returning an object, per `usePlayerSelector`'s
    contract — two boolean comparisons cost nothing, and one fresh object per
    call never settles. Neither of these changes while an episode plays, so this
    component re-renders when the listener acts and not once per position tick.

    The bug this closes: the hero was drawn entirely from a query with a 30s
    stale time and no connection to the machine at all, so pressing play here
    started the audio and then left the panel describing the episode as it was
    half a minute ago — a "Continue listening" button on something already
    playing, and a progress bar frozen where the server last heard about it.
  */
  const isCurrent = usePlayerSelector((state) => state.current?.id === entry.episode.id);
  const isPlaying = usePlayerSelector(
    (state) => state.current?.id === entry.episode.id && state.status === 'playing',
  );
  /*
    Resolved on the client, which is the one thing this hero can do that the
    tinted *pages* cannot.

    Those render on the server and have to emit both palettes and let CSS
    choose, because the theme is not known until a blocking script has read
    localStorage. This section is client-rendered already — it is gated on the
    session and shows a skeleton until that resolves — so it can simply ask
    which theme is on, and `useThemeChoice` re-renders it if the answer changes
    under it, including when the OS flips at sunset while `system` is selected.
  */
  const isLight = isLightNow(useThemeChoice());
  const tint = entry.accentColor ? deriveTint(entry.accentColor, isLight ? 'light' : 'dark') : null;
  /**
   * The show's colour as a whole palette, not just a background.
   *
   * The panel was painted with `tint.wash` — a deliberately dark value, because
   * this ground has to work under artwork — while everything on top of it kept
   * reading the *theme's* tokens. In the dark theme those agree by luck. In the
   * light theme this hero rendered `#17140F` text on a near-black panel: the
   * episode title, the timecodes and the whole "Start over" button were
   * present, correct and invisible, on the most-visited screen in the app.
   *
   * Scoping a scheme here fixes every descendant at once and cannot drift the
   * way a hand-picked foreground colour would — it is the same move the
   * expanded player and the podcast page make, for the same reason.
   */
  const scheme = entry.accentColor
    ? tintedScheme(entry.accentColor, isLight ? 'light' : 'dark')
    : null;

  const playable = {
    ...entry.episode,
    artworkUrl: entry.episode.artworkUrl ?? entry.podcastArtworkUrl,
    podcastTitle: entry.podcastTitle,
    accentColor: entry.accentColor,
  };

  const press = usePressScale(0.97);
  const settle = useTransition('responsive');
  const reduced = useReducedMotion();

  /**
   * A pop on the button itself, every time play/pause flips.
   *
   * Driven from a motion value rather than declared as an `animate` prop,
   * because it has to re-run on a change that does not alter the value it
   * animates: the button ends at scale 1 either way, so a declarative
   * `animate={{ scale: 1 }}` has nothing to transition and simply never fires.
   * Firing it imperatively is what makes the second press feel like the first.
   *
   * Skipped on mount. A hero that flinches as the page settles is the app
   * reacting to its own arrival, and the listener did nothing.
   */
  const pop = useMotionValue(1);
  const popped = useRef(false);

  useEffect(() => {
    if (!popped.current) {
      popped.current = true;
      return;
    }

    if (reduced) return;

    const controls = animate(pop, [1, 0.92, 1.05, 1], {
      duration: 0.42,
      times: [0, 0.18, 0.55, 1],
      ease: 'easeOut',
    });

    return () => controls.stop();
  }, [isPlaying, pop, reduced]);

  return (
    <article
      className="relative -mx-5 overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-7 md:mx-0 md:rounded-[var(--radius-lg)] md:border-0 md:px-8 md:py-8"
      style={
        scheme
          ? // `surface`, not `bg`: this is a panel sitting on the page, and the
            // scheme's own surface is the value that says so.
            { ...colorVarStyle(scheme), backgroundColor: scheme.surface }
          : undefined
      }
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-8">
        {/* One cover, two sizes. Sized by its wrapper rather than by the
            component's own `size` prop, so a phone and a desktop share one
            element and one download — rendering a 92px copy and a 220px copy
            and hiding one would fetch both. */}
        <div className="hidden w-[220px] shrink-0 md:block">
          <Artwork
            src={entry.episode.artworkUrl ?? entry.podcastArtworkUrl}
            alt=""
            size={220}
            priority
            responsive
            sizes="220px"
          />
        </div>

        <div className="min-w-0 flex-1">
          <Eyebrow>{t.t('home.pickUp')}</Eyebrow>

          <div className="mt-4 flex items-start gap-4 md:block">
            {/* The phone's copy of the cover, beside the title rather than
                above it: stacked, a 92px square and a two-line title spend
                most of a 390px screen on a single episode. */}
            <div className="w-[92px] shrink-0 md:hidden">
              <Artwork
                src={entry.episode.artworkUrl ?? entry.podcastArtworkUrl}
                alt=""
                size={92}
                priority
                responsive
                sizes="92px"
              />
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="type-hero m-0 max-w-[38ch]">
                <Link
                  href={`/episode/${entry.episode.id}` as Route}
                  className="clamp-3 text-[var(--color-text-primary)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
                >
                  {entry.episode.title}
                </Link>
              </h3>
              <p className="type-callout clamp-1 mt-1.5 mb-0 text-[var(--color-text-tertiary)]">
                {entry.podcastTitle}
              </p>
            </div>
          </div>

          <div className="mt-5 max-w-[480px] md:mt-6">
            {isCurrent ? (
              <LiveProgress
                key={entry.episode.id}
                entry={entry}
                playing={isPlaying}
                fill={tint?.fill}
                fallbackFraction={fraction}
              />
            ) : (
              <>
                <Track fraction={fraction} fill={tint?.fill} />
                <div className="mt-1.5 flex justify-between text-[var(--color-text-tertiary)]">
                  <span className="type-timecode">
                    {formatTimestamp(entry.positionSec)}
                  </span>
                  {left ? (
                    <span className="type-timecode">
                      {t.t('home.timeLeft', { duration: left })}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {/*
              One button, three meanings, decided by the machine rather than by
              the query. While this episode is the current one it is the same
              play/pause control the player has — pressing it here and pressing
              it in the bar do the identical thing, and both surfaces show the
              result immediately, because both are reading the same state.
            */}
            <m.button
              type="button"
              onClick={() => (isCurrent ? toggle() : void play(playable))}
              whileTap={{ scale: press }}
              transition={settle}
              style={{ scale: pop }}
              className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2.5 rounded-full border-0 bg-[var(--color-ink)] px-6 type-body-strong text-[var(--color-text-on-ink)] hover:opacity-90 sm:flex-none"
            >
              {/*
                The glyph is swapped, not redrawn — and the swap has to be big
                enough to see.

                The first version of this scaled and rotated the mark a little
                and was genuinely imperceptible, for a reason worth writing
                down: the glyph is twelve pixels tall. A 0.6 scale change on a
                12px object is a seven-pixel movement, over in a fifth of a
                second, on the thing your own finger is covering at the moment
                it happens. The physics were right and there was nothing to
                look at.

                So the motion is carried by things that are *not* the glyph. A
                ring expands out from under it, at a size the button itself
                does not have, which puts movement outside the area the cursor
                hides. The mark makes a full quarter-turn rather than a nudge,
                and the pair of them pop the whole cluster slightly past its
                resting size on the way back — see `pop` above.
              */}
              <span className="relative grid h-5 w-5 shrink-0 place-items-center">
                {/* The ring. Keyed so a fresh one runs on every toggle, and
                    `pointer-events-none` because it briefly covers the button
                    it belongs to. */}
                <AnimatePresence initial={false}>
                  <m.span
                    key={`ring-${isPlaying}`}
                    aria-hidden="true"
                    initial={{ scale: 0.2, opacity: 0.55 }}
                    animate={{ scale: 2.6, opacity: 0 }}
                    transition={{ duration: 0.55, ease: 'easeOut' }}
                    className="pointer-events-none absolute inset-0 col-start-1 row-start-1 rounded-full border-2 border-current"
                  />
                </AnimatePresence>

                <AnimatePresence mode="popLayout" initial={false}>
                  <m.span
                    key={isPlaying ? 'pause' : 'play'}
                    initial={{ scale: 0, opacity: 0, rotate: -90 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0, opacity: 0, rotate: 90 }}
                    // Sprung on scale and rotation, tweened on opacity: the
                    // motion package's rule, and the reason this settles with
                    // weight rather than easing flatly to a stop.
                    transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
                    className="col-start-1 row-start-1 flex"
                  >
                    {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
                  </m.span>
                </AnimatePresence>
              </span>

              {/* The word changes with the glyph and is deliberately not
                  animated: a label that slides is a label you cannot read, and
                  this one is the accessible name of the control. */}
              {isPlaying ? t.t('episode.pause') : t.t('home.continue')}
            </m.button>

            {/* Start over is not a duplicate of Resume. A half-finished episode
                is the one case where "play" is genuinely ambiguous, and the
                answer the button gives — carry on — is the wrong one often
                enough that the alternative has to be visible rather than
                buried behind a long-press. `playAt` skips the resume lookup
                outright, so it cannot be quietly overruled by the server's
                stored position. */}
            <button
              type="button"
              onClick={() => void playAt(playable, 0)}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-transparent px-5 type-body-strong text-[var(--color-text-primary)] transition-[transform,background-color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100"
            >
              {t.t('home.startOver')}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * One of the also-rans.
 *
 * A card, and the only card chrome on Home — everything else is artwork with
 * text under it. These earn it because they are a set of peers sitting in a
 * scroller, and without an edge each one there is nothing to say where a swipe
 * has landed.
 */
function ProgressCard({ entry }: { entry: ContinueEntry }) {
  const t = useTranslator();
  const { play, toggle } = usePlayerActions();
  const { left, fraction } = remainingOf(entry, t);
  const duration = t.duration(entry.durationSec ?? entry.episode.durationSec);

  // Same live wiring as the hero, for the same reason: a row showing a play
  // glyph for the episode currently coming out of the speakers is the app
  // disagreeing with itself.
  const isCurrent = usePlayerSelector((state) => state.current?.id === entry.episode.id);
  const isPlaying = usePlayerSelector(
    (state) => state.current?.id === entry.episode.id && state.status === 'playing',
  );

  return (
    <article className="flex h-full flex-col gap-3.5 rounded-[var(--radius-lg)] bg-[var(--color-surface-raised)] p-4 [box-shadow:var(--elevation-sm)]">
      <div className="flex items-center gap-3.5">
        <Artwork
          src={entry.episode.artworkUrl ?? entry.podcastArtworkUrl}
          alt=""
          size={64}
        />
        <div className="min-w-0 flex-1">
          <h3 className="type-title3 m-0">
            <Link
              href={`/episode/${entry.episode.id}` as Route}
              className="clamp-2 text-[var(--color-text-primary)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
            >
              {entry.episode.title}
            </Link>
          </h3>
          <p className="type-caption clamp-1 mt-1 mb-0 text-[var(--color-text-tertiary)]">
            {entry.podcastTitle}
          </p>
        </div>
      </div>

      {/* The play control sits on the floor of the card beside the bar it
          belongs to, rather than in the corner of the artwork. On the artwork
          it covers the thing the reader is using to recognise the show. */}
      <div className="mt-auto flex items-center gap-3">
        <button
          type="button"
          onClick={() => (isCurrent ? toggle() : void play(playableFromQueueEntry(entry)))}
          aria-label={
            isPlaying ? t.t('episode.pause') : t.t('home.resume', { title: entry.episode.title })
          }
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-[var(--color-ink)] text-[var(--color-text-on-ink)] transition-[transform,opacity] duration-[var(--duration-instant)] ease-standard hover:opacity-90 active:scale-[0.97] motion-reduce:active:scale-100"
        >
          {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
        </button>

        <div className="min-w-0 flex-1">
          {isCurrent ? (
            <LiveTrack entry={entry} playing={isPlaying} />
          ) : (
            <Track fraction={fraction} />
          )}
          <div className="mt-1.5 flex justify-between text-[var(--color-text-tertiary)]">
            {left ? (
              <span className="type-timecode">
                {t.t('home.timeLeft', { duration: left })}
              </span>
            ) : (
              <span />
            )}
            {duration ? <span className="type-timecode">{duration}</span> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * The rule-and-label eyebrow.
 *
 * The one place the accent is spent on text. It marks the section that is
 * about *what is playing* — which is the only thing the accent means anywhere
 * else in this palette — so it is consistent rather than decorative.
 */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="type-overline m-0 flex items-center gap-2 text-[var(--color-accent-text)]">
      <span aria-hidden="true" className="h-px w-4 bg-current md:w-5" />
      {children}
    </p>
  );
}

/**
 * Progress, as a bar.
 *
 * The same shape the player uses, so the two are recognisably the same idea —
 * and it needs no label, which is what lets it sit under a title without
 * adding a line of text to every row it appears in.
 */
function Track({ fraction, fill }: { fraction: number; fill?: string }) {
  return (
    <div
      aria-hidden="true"
      className="h-1 overflow-hidden rounded-full bg-[var(--color-border)] md:h-[5px]"
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${fraction * 100}%`,
          backgroundColor: fill ?? 'var(--color-accent)',
        }}
      />
    </div>
  );
}

/**
 * The card's bar, live. The hero's `LiveProgress` without the timecodes —
 * these rows carry "time left" and a total, neither of which is worth a
 * per-second re-render on three cards at once.
 */
function LiveTrack({ entry, playing }: { entry: ContinueEntry; playing: boolean }) {
  const total = entry.durationSec ?? entry.episode.durationSec;
  /** Position only while paused, so a seek still moves the bar. */
  const pausedPositionSec = usePlayerSelector((s) =>
    s.status === 'playing' ? 0 : s.positionSec,
  );
  const scaleX = useMotionValue(
    total && total > 0 ? Math.min(1, entry.positionSec / total) : 0,
  );

  /**
   * Only while playing, unlike the loop this replaced.
   *
   * That loop woke every frame for the life of the card whether or not
   * anything was moving, because stopping it would have frozen the bar after a
   * paused seek. The one-shot below covers that case instead — the same idiom
   * the caption column and the transcript panel already use — so a home screen
   * showing three of these costs nothing at all while paused.
   */
  const write = useCallback(() => {
    if (!total || total <= 0) return;
    scaleX.set(Math.min(1, Math.max(0, readPosition() / total)));
  }, [total, scaleX]);

  useFrameLoop(Boolean(playing && total && total > 0), write);

  // Paused, the playhead still moves on a seek, and no loop is running to
  // notice. `pausedPositionSec` is constant during playback, so this costs one
  // effect per pause rather than one per tick.
  useEffect(() => {
    if (!playing) write();
  }, [playing, pausedPositionSec, write]);

  return (
    <div
      aria-hidden="true"
      className="h-1 overflow-hidden rounded-full bg-[var(--color-border)] md:h-[5px]"
    >
      <m.div
        className="h-full w-full origin-left rounded-full bg-[var(--color-accent)]"
        style={{ scaleX }}
      />
    </div>
  );
}

/**
 * The same bar and timecodes, driven by the machine instead of by the query.
 *
 * Split into its own component so that being live costs one small subtree
 * rather than the whole hero: the timecodes below tick once a second, and the
 * hero contains the artwork, the title link and two buttons that have no
 * business re-rendering for a clock.
 *
 * The bar itself re-renders for nothing at all. It is written straight to a
 * motion value from a `requestAnimationFrame` loop reading `readPosition()` —
 * the same smoothed clock the player's own scrubber and the caption sweep run
 * on, so all three agree to the frame rather than to whatever each last heard.
 * A bar animated off React state would be capped at the machine's 25Hz report
 * and would stutter visibly against the scrubber sitting a few hundred pixels
 * below it.
 */
function LiveProgress({
  entry,
  playing,
  fill,
  fallbackFraction,
}: {
  entry: ResumeEntry;
  playing: boolean;
  fill?: string;
  /** Used until the engine has a position to give — a fresh tab resuming. */
  fallbackFraction: number;
}) {
  const t = useTranslator();
  const total = entry.durationSec ?? entry.episode.durationSec;
  /** Position only while paused, so a seek still moves the bar. */
  const pausedPositionSec = usePlayerSelector((s) =>
    s.status === 'playing' ? 0 : s.positionSec,
  );

  const scaleX = useMotionValue(fallbackFraction);
  const [positionSec, setPositionSec] = useState(entry.positionSec);

  // Whole seconds only: the label reads `12:04`, so writing state on any
  // finer grain is a re-render that cannot change a pixel.
  const shownSecRef = useRef(-1);

  const write = useCallback(() => {
    const position = readPosition();
    scaleX.set(total && total > 0 ? Math.min(1, Math.max(0, position / total)) : 0);

    const whole = Math.floor(position);
    if (whole !== shownSecRef.current) {
      shownSecRef.current = whole;
      setPositionSec(whole);
    }
  }, [total, scaleX]);

  // The clock remains useful even when a feed has no duration. The one-shot
  // also initializes a newly selected episode and handles paused seeks.
  useFrameLoop(playing, write);

  useEffect(() => {
    write();
  }, [playing, pausedPositionSec, write]);

  const left = total && total > 0 ? t.duration(Math.max(0, total - positionSec)) : null;

  return (
    <>
      <div
        aria-hidden="true"
        className="h-1 overflow-hidden rounded-full bg-[var(--color-border)] md:h-[5px]"
      >
        <m.div
          className="h-full w-full origin-left rounded-full"
          style={{ scaleX, backgroundColor: fill ?? 'var(--color-accent)' }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[var(--color-text-tertiary)]">
        <span className="type-timecode">{formatTimestamp(positionSec)}</span>
        {left ? (
          <span className="type-timecode">{t.t('home.timeLeft', { duration: left })}</span>
        ) : null}
      </div>
    </>
  );
}

function PlayGlyph() {
  return (
    <svg width="11" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
      <path d="M0 0 10 6 0 12Z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="11" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
      <path d="M0 0h3v12H0zM7 0h3v12H7z" />
    </svg>
  );
}
