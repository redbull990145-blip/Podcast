'use client';

import { queryKeys } from '@cue/api-client';
import { SKIP_BACK_SEC, SKIP_FORWARD_SEC } from '@cue/core';
import { deriveTint, icon } from '@cue/design';
import { duration, gesture } from '@cue/motion';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { animate } from 'motion/react';
import { useEffect, useState } from 'react';
import { Artwork } from '@/components/media/artwork';
import { api } from '@/lib/api';
import { useCanTravel, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';
import { AmbientBackdrop } from './ambient-backdrop';
import { Captions } from './captions';
import { PlayPauseButton, SkipButton, SpeedButton } from './controls';
import { ProgressBar } from './progress-bar';
import { useTranslator } from '@/components/i18n/locale-provider';

/**
 * The player.
 *
 * **One component, two appearances.** A single `expansion` motion value runs
 * 0 → 1, and everything — artwork size and position, metadata offset, control
 * scale, the backdrop — is derived from it. The mini player does not disappear
 * and get replaced by a full player; it *becomes* one, continuously.
 *
 * That is also what makes the gesture interruptible for free. The drag writes
 * the same value the release spring settles, so a downward swipe halfway
 * through opening is picked up on the next frame — there is no "finish the
 * opening animation, then start closing", because there is only one number and
 * whoever touched it last owns it.
 *
 * Nothing here is React state. Expansion is a motion value, so dragging
 * re-renders nothing; only the open/closed *intent* is state, and it changes
 * once per gesture.
 */
/** Height of the collapsed player, in px. */
const MINI_HEIGHT = 72;

/**
 * The width at which the player splits into two columns.
 *
 * Below this the artwork and the captions would each get half of not enough,
 * so they take turns instead — see `showCaptions` below. Matches the shell's
 * own sidebar breakpoint so the two never disagree about what "wide" means.
 */
const TWO_COLUMN_AT = 1024;

/**
 * Where the artwork sits at each end of the travel.
 *
 * Named rather than inlined into the transforms because the reduced-motion
 * path needs the same two endpoints without the journey between them — and a
 * second copy of these numbers is a second thing to keep in sync.
 *
 * The full-state position is a function rather than a constant now: in two
 * columns the cover belongs in the left one, not the middle of the window.
 */
const ART = {
  mini: { size: 48, radius: 6, left: '16px', top: '12px' },
} as const;

function fullArt(wide: boolean, columnWidth: number) {
  const size = wide ? 300 : 264;
  return {
    size,
    radius: 18,
    // Centred in whichever box it belongs to: the left column when there are
    // two, the whole sheet when there is one.
    left: wide ? `calc(${columnWidth / 2}px - ${size / 2}px)` : `calc(50% - ${size / 2}px)`,
    top: wide ? '96px' : '92px',
  };
}

export function Player() {
  const t = useTranslator();
  const state = usePlayerState();
  const actions = usePlayerActions();
  const [expanded, setExpanded] = useState(false);

  /**
   * Whether the sheet may cross the screen to get where it is going.
   *
   * When it may not, every travelling property below is read as a plain value
   * at its destination instead of as a motion value in transit. The opacity
   * crossfade is left alone — it is what keeps the change perceptible once the
   * movement is gone, and opacity is not what triggers vestibular symptoms.
   */
  const travel = useCanTravel();
  const settle = useTransition('expressive');

  /** 0 = mini, 1 = full. The single source of truth for the whole layout. */
  const expansion = useMotionValue(0);

  // Settle toward the committed state. `animate` on a motion value keeps the
  // spring outside React entirely.
  useEffect(() => {
    const controls = animate(expansion, expanded ? 1 : 0, settle);
    return () => controls.stop();
  }, [expanded, expansion, settle]);

  // Escape closes, as it does for every other overlay on the web.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const episode = state.current;

  // Everything from here down runs before the early return below. React
  // identifies hooks by call order, so returning above any of them would change
  // that order the moment an episode loads — the classic crash that only
  // appears once the feature starts working.

  /**
   * How far the sheet sits below the fold when collapsed.
   *
   * Measured rather than expressed as `calc(100% - 72px)`: Motion interpolates
   * numbers and single-unit strings, and silently resolves a mixed-unit `calc`
   * to its percentage part — which pushed the whole mini player off-screen.
   */
  const [viewportHeight, setViewportHeight] = useState(0);
  /** Sheet width, which is the window minus the shell's sidebar when there is one. */
  const [sheetWidth, setSheetWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      setViewportHeight(window.innerHeight);
      // The sheet is inset by the sidebar at `md`, and the artwork has to be
      // centred in the sheet rather than in the window.
      setSheetWidth(window.innerWidth - (window.innerWidth >= 768 ? 240 : 0));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const restY = Math.max(0, viewportHeight - MINI_HEIGHT);

  /**
   * Two columns, or one at a time.
   *
   * Measured rather than done in CSS because the artwork's travel is driven by
   * motion values, and a media query cannot reach into one. Guarded on
   * `sheetWidth > 0` so the first server render and the first client render
   * agree — reading `window` during render would be a hydration mismatch.
   */
  const wide = sheetWidth >= TWO_COLUMN_AT;
  const artFull = fullArt(wide, wide ? sheetWidth / 2 : sheetWidth);

  /**
   * Whether the captions have the screen to themselves.
   *
   * Only meaningful in one column: at two, they are always on the right and
   * this is ignored. Apple's own answer on a phone — the artwork and the words
   * are both worth the full width, so they take turns rather than sharing.
   */
  const [captionsOpen, setCaptionsOpen] = useState(false);

  const sheetY = useTransform(expansion, [0, 1], [restY, 0]);
  const scrimOpacity = useTransform(expansion, [0, 1], [0, 1]);
  const miniOpacity = useTransform(expansion, [0, 0.35], [1, 0]);
  const fullOpacity = useTransform(expansion, [0.4, 1], [0, 1]);
  const artSize = useTransform(expansion, [0, 1], [ART.mini.size, artFull.size]);
  const artRadius = useTransform(expansion, [0, 1], [ART.mini.radius, artFull.radius]);
  const artLeft = useTransform(expansion, [0, 1], [ART.mini.left, artFull.left]);
  const artTop = useTransform(expansion, [0, 1], [ART.mini.top, artFull.top]);

  /**
   * This episode's own colour, fetched once it is playing.
   *
   * The show's colour — which the player already carries — is shown first and
   * this replaces it when it lands, usually within a few hundred milliseconds.
   * Asked for only while expanded: the mini bar tints one small button and one
   * progress line, which the show's colour serves perfectly well, and there is
   * no reason to reach for a publisher's CDN for that.
   */
  const { data: tintData } = useQuery({
    queryKey: queryKeys.episode.tint(episode?.id ?? ''),
    queryFn: ({ signal }) => api.getEpisodeTint(episode!.id, { signal }),
    enabled: Boolean(episode?.id) && expanded,
    // A cover's colour does not change. Once known, never asked again.
    staleTime: Infinity,
    gcTime: Infinity,
    // Nothing breaks without it — the show's colour stays. Not worth a retry
    // storm against an image CDN that is having a bad day.
    retry: false,
  });

  const accentColor = tintData?.accentColor ?? episode?.accentColor ?? null;
  const accent = accentColor ? deriveTint(accentColor, 'dark') : null;

  if (!episode) return null;

  const playing = state.status === 'playing';
  const loading = state.status === 'loading';

  /** Where the artwork rests, for the path that does not travel there. */
  const art = expanded ? artFull : ART.mini;

  return (
    <>
      {/* Scrim. Pointer events only once expanded, so it never intercepts
          clicks on the page behind the mini player. */}
      <m.div
        aria-hidden="true"
        onClick={() => setExpanded(false)}
        className="fixed inset-0 z-30 bg-[var(--color-scrim)]"
        style={{ opacity: scrimOpacity, pointerEvents: expanded ? 'auto' : 'none' }}
      />

      <m.div
        role="region"
        aria-label={t.t('nav.player')}
        // Dragging *is* travel, so there is nothing to gate down to — the
        // gesture is withdrawn and the buttons that do the same job stay. Both
        // the mini bar and the grab handle open and close without it, so no
        // capability is lost with the m.
        drag={travel ? 'y' : false}
        dragConstraints={{ top: 0, bottom: 0 }}
        // Resistance past the edges: the sheet still tracks the finger, which
        // is what makes a boundary feel physical rather than broken.
        dragElastic={1 - gesture.rubberBand}
        onDragStart={() => {
          // A drag from the collapsed state is a request to open.
          if (!expanded) setExpanded(true);
        }}
        onDragEnd={(_event, info) => {
          // Velocity-first: a fast flick commits regardless of distance, which
          // is how people actually dismiss a sheet. Distance-only thresholds
          // punish flicks and feel sticky.
          const flicked = Math.abs(info.velocity.y) >= gesture.commitVelocity;
          if (flicked) {
            setExpanded(info.velocity.y < 0);
            return;
          }
          setExpanded(info.offset.y < window.innerHeight * gesture.commitDistanceRatio);
        }}
        style={{ y: travel ? sheetY : (expanded ? 0 : restY) }}
        className={[
          'fixed inset-x-0 bottom-0 z-40 h-dvh overflow-hidden border-t border-[var(--color-border)]',
          'bg-[var(--color-surface-overlay)] md:left-[240px]',
          // Only claim the touch gesture when there is a gesture to claim.
          travel ? 'touch-none' : '',
        ].join(' ')}
      >
        {/*
          The backdrop, behind everything in the sheet.

          Faded in with the full layout rather than always painted: at mini
          height it would be a 72px sliver of blurred cover behind a bar that
          already sits on a solid surface, which reads as a rendering fault
          rather than as atmosphere.
        */}
        <m.div className="absolute inset-0" style={{ opacity: fullOpacity }}>
          <AmbientBackdrop artworkUrl={episode.artworkUrl} accentColor={accentColor} />
        </m.div>
        {/* ------------------------------------------------------- mini -- */}
        <m.div
          style={{ opacity: miniOpacity, pointerEvents: expanded ? 'none' : 'auto' }}
          className="absolute inset-x-0 top-0 h-[72px]"
        >
          <div className="flex h-full items-center gap-3 px-4">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={t.t('player.open')}
              aria-expanded={expanded}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-start"
            >
              {/* Spacer: the artwork itself is rendered once, below, so it can
                  travel continuously between the two layouts. */}
              <span aria-hidden="true" className="h-12 w-12 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="type-body-strong clamp-1 block text-[var(--color-text-primary)]">
                  {episode.title}
                </span>
                <span className="type-caption clamp-1 block text-[var(--color-text-secondary)]">
                  {episode.podcastTitle}
                </span>
              </span>
            </button>

            <SkipButton direction="back" seconds={SKIP_BACK_SEC} onClick={actions.skipBack} />
            <PlayPauseButton
              playing={playing}
              loading={loading}
              onToggle={actions.toggle}
              size={40}
              tint={accent?.fill}
            />
          </div>

          <div className="absolute inset-x-0 bottom-0 px-4">
            <ProgressBar
              durationSec={state.durationSec}
              isPlaying={playing}
              tint={accent?.fill}
              compact
            />
          </div>
        </m.div>

        {/* ------------------------------------------------------- full -- */}
        <m.div
          style={{ opacity: fullOpacity, pointerEvents: expanded ? 'auto' : 'none' }}
          className="absolute inset-0 flex h-full flex-col px-6 pt-4 pb-10"
        >
          {/* Grab handle. The only affordance saying this sheet can be dragged. */}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={t.t('player.close')}
            className="mx-auto mb-6 h-11 w-16 shrink-0 cursor-pointer border-0 bg-transparent"
          >
            <span className="mx-auto block h-1 w-10 rounded-full bg-[var(--color-border-strong)]" />
          </button>

          <div
            className={[
              'flex min-h-0 flex-1',
              wide ? 'flex-row items-stretch gap-10' : 'flex-col items-center',
            ].join(' ')}
          >
            {/* ------------------------------------------- artwork column -- */}
            {/* Hidden outright when the captions have taken over a narrow
                screen, so the travelling cover is not left floating over them. */}
            <div
              className={[
                'flex min-w-0 flex-col items-center',
                wide ? 'flex-1 justify-start' : 'w-full',
                !wide && captionsOpen ? 'hidden' : '',
              ].join(' ')}
            >
              {/* Artwork slot — the real artwork sits above this, travelling. */}
              <div
                aria-hidden="true"
                style={{ height: artFull.size, width: artFull.size }}
                className="shrink-0"
              />

              <div className="mt-8 w-full max-w-[420px] text-center">
                <h2 className="type-title3 clamp-2 m-0 text-[var(--color-text-primary)]">
                  {episode.title}
                </h2>
                <p className="type-callout clamp-1 mt-1 mb-0 text-[var(--color-text-secondary)]">
                  {episode.podcastTitle}
                </p>
              </div>

              <div className="mt-8 w-full max-w-[420px]">
                <ProgressBar
                  durationSec={state.durationSec}
                  isPlaying={playing}
                  tint={accent?.fill}
                />
              </div>

              <div className="mt-6 flex items-center gap-5">
                <SkipButton direction="back" seconds={SKIP_BACK_SEC} onClick={actions.skipBack} />
                <PlayPauseButton
                  playing={playing}
                  loading={loading}
                  onToggle={actions.toggle}
                  size={64}
                  tint={accent?.fill}
                />
                <SkipButton
                  direction="forward"
                  seconds={SKIP_FORWARD_SEC}
                  onClick={actions.skipForward}
                />
              </div>

              <div className="mt-6 flex items-center gap-2">
                <SpeedButton rate={state.rate} onChange={actions.setRate} />
                {/* One column has to choose between the cover and the words, so
                    it gets a switch. Two columns show both and need none. */}
                {!wide ? (
                  <CaptionsToggle open={captionsOpen} onToggle={() => setCaptionsOpen(true)} />
                ) : null}
              </div>

              <AnimatePresence>
                {state.error ? (
                  <m.p
                    role="alert"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    // Opacity is tweened, never sprung, and survives reduced
                    // motion untouched — it is how the error stays perceptible
                    // once everything else has stopped moving.
                    transition={{ duration: duration.fast / 1000 }}
                    className="type-callout mt-6 mb-0 text-center text-[var(--color-danger)]"
                  >
                    {state.error}
                  </m.p>
                ) : null}
              </AnimatePresence>
            </div>

            {/* ------------------------------------------ captions column -- */}
            {wide || captionsOpen ? (
              <div className={['flex min-h-0 flex-col', wide ? 'flex-1' : 'w-full flex-1'].join(' ')}>
                {!wide ? (
                  <div className="mb-2 flex shrink-0 justify-end">
                    <CaptionsToggle open onToggle={() => setCaptionsOpen(false)} />
                  </div>
                ) : null}

                {/* Keyed on the episode so switching tracks resets the scroll
                    rather than leaving the new transcript parked mid-way down
                    where the last one happened to be. */}
                <Captions key={episode.id} episodeId={episode.id} className="min-h-0 flex-1" />
              </div>
            ) : null}
          </div>
        </m.div>

        {/* ------------------------------------------------- the artwork -- */}
        {/* Rendered exactly once and positioned from `expansion`, which is what
            makes it read as the same object moving rather than two images
            crossfading. */}
        <m.div
          aria-hidden="true"
          className={[
            'pointer-events-none absolute overflow-hidden',
            // The cover lives outside both columns so it can travel between the
            // mini bar and the full layout without being re-parented. That also
            // means hiding the artwork *column* does not hide it — it has to be
            // withdrawn explicitly, or it floats over the captions that just
            // took the screen.
            !wide && captionsOpen ? 'hidden' : '',
          ].join(' ')}
          style={
            travel
              ? {
                  width: artSize,
                  height: artSize,
                  borderRadius: artRadius,
                  left: artLeft,
                  top: artTop,
                }
              : {
                  // Same endpoints, no journey: the cover is simply the right
                  // size in the right place for the state the player is in.
                  width: art.size,
                  height: art.size,
                  borderRadius: art.radius,
                  left: art.left,
                  top: art.top,
                }
          }
        >
          {/* `fill` so the animated wrapper owns the dimensions. Requesting the
              large resolution means the image is already sharp when expanded
              rather than upscaling as it grows. */}
          <Artwork src={episode.artworkUrl} alt={episode.podcastTitle} size={300} fill />
        </m.div>
      </m.div>
    </>
  );
}

/**
 * The switch between the cover and the words, on screens too narrow for both.
 *
 * A speech bubble rather than the letter "A": this is the same control Apple
 * Music uses and the same one people already reach for, and a lettermark would
 * have to be translated to keep meaning anything.
 */
function CaptionsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useTranslator();

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      aria-label={open ? t.t('captions.hide') : t.t('captions.show')}
      className={[
        'flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0',
        'transition-colors',
        open
          ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
          : 'bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
      ].join(' ')}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={icon.captions} />
      </svg>
    </button>
  );
}
