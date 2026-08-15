'use client';

import { SKIP_BACK_SEC, SKIP_FORWARD_SEC } from '@cue/core';
import { deriveTint } from '@cue/design';
import { duration, gesture } from '@cue/motion';
import { AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { animate } from 'motion/react';
import { useEffect, useState } from 'react';
import { Artwork } from '@/components/media/artwork';
import { useCanTravel, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';
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
 * Where the artwork sits at each end of the travel.
 *
 * Named rather than inlined into the transforms because the reduced-motion
 * path needs the same two endpoints without the journey between them — and a
 * second copy of these numbers is a second thing to keep in sync.
 */
const ART = {
  mini: { size: 48, radius: 6, left: '16px', top: '12px' },
  full: { size: 264, radius: 18, left: 'calc(50% - 132px)', top: '92px' },
} as const;

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

  useEffect(() => {
    const measure = () => setViewportHeight(window.innerHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const restY = Math.max(0, viewportHeight - MINI_HEIGHT);

  const sheetY = useTransform(expansion, [0, 1], [restY, 0]);
  const scrimOpacity = useTransform(expansion, [0, 1], [0, 1]);
  const miniOpacity = useTransform(expansion, [0, 0.35], [1, 0]);
  const fullOpacity = useTransform(expansion, [0.4, 1], [0, 1]);
  const artSize = useTransform(expansion, [0, 1], [ART.mini.size, ART.full.size]);
  const artRadius = useTransform(expansion, [0, 1], [ART.mini.radius, ART.full.radius]);
  const artLeft = useTransform(expansion, [0, 1], [ART.mini.left, ART.full.left]);
  const artTop = useTransform(expansion, [0, 1], [ART.mini.top, ART.full.top]);

  const accent = episode?.accentColor ? deriveTint(episode.accentColor, 'dark') : null;

  if (!episode) return null;

  const playing = state.status === 'playing';
  const loading = state.status === 'loading';

  /** Where the artwork rests, for the path that does not travel there. */
  const art = expanded ? ART.full : ART.mini;

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
          'fixed inset-x-0 bottom-0 z-40 h-dvh border-t border-[var(--color-border)]',
          'bg-[var(--color-surface-overlay)] md:left-[240px]',
          // Only claim the touch gesture when there is a gesture to claim.
          travel ? 'touch-none' : '',
        ].join(' ')}
      >
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
          className="flex h-full flex-col items-center px-6 pt-4 pb-10"
        >
          {/* Grab handle. The only affordance saying this sheet can be dragged. */}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={t.t('player.close')}
            className="mb-8 h-11 w-16 cursor-pointer border-0 bg-transparent"
          >
            <span className="mx-auto block h-1 w-10 rounded-full bg-[var(--color-border-strong)]" />
          </button>

          {/* Artwork slot — the real artwork sits above this, travelling. */}
          <div
            aria-hidden="true"
            style={{ height: ART.full.size, width: ART.full.size }}
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
        </m.div>

        {/* ------------------------------------------------- the artwork -- */}
        {/* Rendered exactly once and positioned from `expansion`, which is what
            makes it read as the same object moving rather than two images
            crossfading. */}
        <m.div
          aria-hidden="true"
          className="pointer-events-none absolute overflow-hidden"
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
          <Artwork src={episode.artworkUrl} alt={episode.podcastTitle} size={264} fill />
        </m.div>
      </m.div>
    </>
  );
}
