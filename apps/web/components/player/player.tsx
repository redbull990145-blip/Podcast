'use client';

import { queryKeys } from '@cue/api-client';
import { SKIP_BACK_SEC, SKIP_FORWARD_SEC } from '@cue/core';
import { colorVarStyle, icon, stage } from '@cue/design';
import { duration } from '@cue/motion';
import { useQuery } from '@tanstack/react-query';
import {
  AnimatePresence,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from 'motion/react';
import * as m from 'motion/react-m';
import { animate } from 'motion/react';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useRef, useState } from 'react';
import { Artwork } from '@/components/media/artwork';
import { api } from '@/lib/api';
import { useCanTravel, usePressScale, useTransition } from '@/lib/motion';
import { usePlayerActions, usePlayerState } from '@/lib/player/store';
import { railWidth, useRailCollapsed } from '@/lib/rail';
import { AmbientBackdrop } from './ambient-backdrop';
import { Captions } from './captions';
import { PlayPauseButton, SkipButton } from './controls';
import { SpeedControl } from './speed-control';
import { ProgressBar } from './progress-bar';
import { useSheetDrag } from './use-sheet-drag';
import { VolumeSlider } from './volume-slider';
import { useTranslator } from '@/components/i18n/locale-provider';

/**
 * The player.
 *
 * **One component, two appearances.** A single `expansion` motion value runs
 * 0 → 1, and everything — artwork size and position, metadata offset, control
 * scale, the backdrop — is derived from it. The mini player does not disappear
 * and get replaced by a full player; it *becomes* one, continuously.
 *
 * That is also what makes the gesture interruptible for free: the drag writes
 * the same value the release spring settles, so a downward swipe halfway
 * through opening is picked up on the next frame — there is no "finish the
 * opening animation, then start closing", because there is only one number and
 * whoever touched it last owns it.
 *
 * Nothing here is React state. Expansion is a motion value, so dragging
 * re-renders nothing; only the open/closed *intent* is state, and it changes
 * once per gesture.
 */
/**
 * Height of the collapsed player, in px.
 *
 * Two numbers, because the collapsed player is two different controls. On a
 * phone it is a strip: cover, title, one button, and a hairline of progress.
 * On a desktop it is the whole transport — five controls, a scrubber with
 * timecodes, speed, queue and volume — which is the shape every desktop media
 * player has, and it does not fit in 72px.
 */
const MINI_HEIGHT = 72;
const MINI_HEIGHT_WIDE = 84;

/*
 * The rail's width comes from `railWidth()` rather than from a constant here.
 *
 * The bar starts exactly where the rail ends, so that the mini artwork lines up
 * with the page's first column — a four-pixel drift there looks like nothing
 * and reads as sloppiness. Now that the rail folds, "where the rail ends" is
 * two numbers, and this is the one place in the app that needs it as a number
 * at all: everything else lays out in CSS against `--measure-sidebar`, which
 * `setRailCollapsed` moves. The bar animates its own inset as a motion value
 * during the expand gesture, which no stylesheet can reach into.
 */
/** Tailwind's `md`, which is where the shell swaps the tab bar for the rail. */
const SIDEBAR_AT = 768;

/**
 * The width at which the player splits into two columns.
 *
 * Below this the artwork and the captions would each get half of not enough,
 * so they take turns instead — see `captionsOpen` below.
 */
const TWO_COLUMN_AT = 1024;

/**
 * The sheet's own padding and column gap, in px.
 *
 * Duplicated from the `px-6` and `gap-8` classes below rather than left implicit
 * because the artwork is positioned absolutely and everything under it is laid
 * out by flexbox — the two have to agree to the pixel or the scrubber does not
 * line up with the cover it sits beneath. Getting this wrong is not a crash, it
 * is a four-pixel drift that looks like nothing and reads as sloppiness.
 */
const SHEET_PAD = 24;
const COLUMN_GAP = 32;

/**
 * The drag strip above the content: `pt-3` + `h-8` + `pb-2`.
 *
 * The cover is positioned absolutely and everything beneath it is laid out by
 * flexbox *below* this strip, so the two have to start from the same number.
 * They did not: the strip is 52px tall and the cover was told to sit at 104,
 * so it hung 52px past the box reserved for it and covered the first line of
 * the episode title.
 */
const HEADER_H = 52;
/** Breathing room between the drag strip and the cover. */
const ART_TOP_GAP = 10;

/**
 * A safe upper bound on what the column under the cover needs: title,
 * scrubber, transport, volume, and the utility row, plus bottom padding.
 *
 * Used to *size* the cover — deliberately an estimate, and deliberately not the
 * measured height. The column's width is the cover's width, so a title wraps to
 * one line or two depending on how big the cover is; sizing the cover from a
 * measurement of something that depends on the cover is a loop that can sit
 * there oscillating between two layouts. The measured height below is used only
 * to centre, which nothing else feeds back into.
 */
const COLUMN_BELOW_ART = 300;

/**
 * Where the artwork sits at each end of the travel.
 *
 * All four numbers are px, and that is the point. The cover used to travel by
 * animating `width`, `height`, `left` and `top` — four layout properties, on
 * every frame, for the whole half-second of the opening. Laying out and
 * re-rasterising an image sixty times to accomplish one movement is precisely
 * the cost the performance budget exists to forbid, and it lands on the single
 * interaction this screen is judged by.
 *
 * Given both ends as plain numbers, the same movement is a `scale` and a
 * `translate` from one to the other, which the compositor does on its own
 * thread without the layout engine ever being asked a question.
 *
 * Positioned on the *inline* start. The whole app mirrors under Arabic, and an
 * element positioned by script rather than by layout would otherwise be the one
 * thing left on the wrong side.
 */
function miniArt(sidebar: number, wide: boolean) {
  return wide
    ? { size: 56, radius: 6, start: sidebar + 24, top: (MINI_HEIGHT_WIDE - 56) / 2 }
    : { size: 48, radius: 5, start: sidebar + 16, top: (MINI_HEIGHT - 48) / 2 };
}

function fullArt(
  wide: boolean,
  columnWidth: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const byWidth = wide ? columnWidth - 128 : viewportWidth - 96;
  const byHeight = viewportHeight - HEADER_H - ART_TOP_GAP - COLUMN_BELOW_ART - SHEET_PAD;
  // Whichever runs out first, capped so the cover does not swallow an
  // ultrawide window and floored so it is still the subject of the screen.
  const size = Math.round(Math.max(180, Math.min(460, byWidth, byHeight)));
  return {
    size,
    radius: 18,
    start: wide
      ? Math.round(SHEET_PAD + columnWidth / 2 - size / 2)
      : Math.round(viewportWidth / 2 - size / 2),
  };
}

/**
 * How far down the cover starts, so cover + controls sit centred in the sheet.
 *
 * Top-anchored, the block ended a couple of hundred pixels short of the floor
 * on a tall window and the whole screen looked like it had been pushed up into
 * a corner. Centred, the empty space is split between the two edges, which is
 * what makes a sheet read as composed rather than as content that ran out.
 *
 * `controlsHeight` is 0 until the column has been measured; falling back to the
 * estimate keeps the first paint in roughly the right place instead of starting
 * at the top and visibly dropping once the measurement lands.
 */
function artTop(viewportHeight: number, artSize: number, controlsHeight: number): number {
  const below = controlsHeight || COLUMN_BELOW_ART;
  const free = viewportHeight - HEADER_H - ART_TOP_GAP - artSize - below - SHEET_PAD;
  return HEADER_H + ART_TOP_GAP + Math.max(0, Math.round(free / 2));
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

  /**
   * Which state the settle spring has already been aimed at.
   *
   * A released drag animates the value itself — it has to, because it carries
   * the gesture's velocity into the spring, and it also has to run when the
   * drag ends where it began and no React state changed at all. This records
   * what it did so the effect below does not immediately start a second,
   * velocity-less animation to the same place and flatten the throw.
   */
  const settledFor = useRef<boolean | null>(null);

  useEffect(() => {
    if (settledFor.current === expanded) return;
    settledFor.current = expanded;
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

  /**
   * Hold the page still underneath, and take its scrollbar with it.
   *
   * Two things, one cause. Scrolling a page nobody can see is the usual sheet
   * complaint — you come back and the screen you left has moved. The scrollbar
   * is the more visible one here: the sheet is `inset-0` and covers the
   * viewport, but the scrollbar is *beside* the viewport, so a full-screen
   * player still had a strip of page chrome down its edge. Which rather
   * undercuts "full screen".
   *
   * The padding is what makes it free. Remove a 15px scrollbar and the page
   * behind gets 15px wider and reflows; that reflow is invisible while covered
   * and very visible during the closing animation, as the page is revealed
   * mid-shuffle. Replacing the scrollbar's width with padding means the layout
   * never learns it went away. `Inline` rather than `right` because under
   * Arabic the scrollbar is on the other side.
   */
  useEffect(() => {
    if (!expanded) return;

    const root = document.documentElement;
    const gutter = window.innerWidth - root.clientWidth;
    const previousOverflow = root.style.overflow;
    const previousPadding = document.body.style.paddingInlineEnd;

    root.style.overflow = 'hidden';
    if (gutter > 0) document.body.style.paddingInlineEnd = `${gutter}px`;

    return () => {
      root.style.overflow = previousOverflow;
      document.body.style.paddingInlineEnd = previousPadding;
    };
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
  const [viewportWidth, setViewportWidth] = useState(0);
  /**
   * Which way the layout runs.
   *
   * Needed because the cover travels on `translate`, and translation is
   * physical however the document is written — so the sign of the journey
   * depends on the script. Read from the document rather than from the locale
   * so it cannot disagree with the `dir` the server actually rendered.
   */
  const [rtl, setRtl] = useState(false);

  /* Subscribed rather than measured: the rail folds without the window
     resizing, so the observer below would never fire and the bar would keep
     starting 188px into the page with nothing beside it. */
  const railCollapsed = useRailCollapsed();

  useEffect(() => {
    const measure = () => {
      setViewportHeight(window.innerHeight);
      setViewportWidth(window.innerWidth);
      setRtl(document.documentElement.dir === 'rtl');
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  /**
   * `viewportWidth` is 0 until the first measurement lands, which is narrower
   * than any breakpoint — so the first paint is the phone layout and it
   * corrects on the same frame the effect runs. The alternative, reading
   * `window` during render, is a hydration mismatch.
   */
  const barWide = viewportWidth >= SIDEBAR_AT;
  const miniHeight = barWide ? MINI_HEIGHT_WIDE : MINI_HEIGHT;
  const restY = Math.max(0, viewportHeight - miniHeight);

  /**
   * The sidebar the *mini* bar has to clear.
   *
   * Only the mini bar. The expanded player deliberately covers the sidebar —
   * see the sheet's geometry below — so this never enters the full layout's
   * measurements.
   */
  const sidebar = barWide ? railWidth(railCollapsed) : 0;

  /**
   * Two columns, or one at a time.
   *
   * Measured rather than done in CSS because the artwork's travel is driven by
   * motion values, and a media query cannot reach into one. Guarded on a
   * measured width so the first server render and the first client render agree
   * — reading `window` during render would be a hydration mismatch.
   */
  const wide = viewportWidth >= TWO_COLUMN_AT;

  /**
   * Whether the captions are showing.
   *
   * One control, two meanings. In one column the artwork and the words are each
   * worth the full width, so they take turns and this says which you are
   * looking at. In two columns they fit side by side, and this says whether the
   * second column is there at all — because someone who just wants to look at
   * the cover had no way to say so.
   *
   * `null` means nobody has said, so the width decides. Once the listener
   * touches the control their answer holds at either width; a preference that
   * resets when you resize the window is not a preference.
   */
  const [captionsChoice, setCaptionsChoice] = useState<boolean | null>(null);
  const captionsOpen = captionsChoice ?? wide;

  /**
   * Whether the sheet is *actually* in two columns right now.
   *
   * Not the same question as "is the window wide". A wide window with the
   * transcript turned off is a one-column layout that happens to be roomy, and
   * everything below — how big the cover is, where it is centred, which way the
   * row flows — has to follow what is on screen rather than what would fit.
   */
  const twoColumn = wide && captionsOpen;

  // The real box flexbox will hand each column, not half the window: the sheet
  // has padding on both edges and a gap down the middle, and all three come out
  // of the width before the split.
  const splitWidth = (viewportWidth - SHEET_PAD * 2 - COLUMN_GAP) / 2;

  /**
   * Both layouts, always — rather than the one currently on screen.
   *
   * Showing the captions changes the cover's size, its centre and how far down
   * the sheet it sits, and every one of those was recomputed as a plain number
   * the instant the control was pressed. The result was a layout swap with no
   * transition at all: a 460px cover became a 300px one, jumped several hundred
   * pixels sideways, and a column of text appeared beside it, all on one frame.
   *
   * Keeping both sets of numbers in hand is what lets the change be *travelled*
   * instead. `columns` below runs 0 → 1 on a spring and everything geometric
   * reads from it, so the cover glides to its new size and place while the
   * transcript opens beside it — the same technique the mini-to-full expansion
   * has always used, applied to the axis that was missing it.
   */
  const artOne = fullArt(false, viewportWidth, viewportWidth, viewportHeight);
  const artTwo = fullArt(true, splitWidth, viewportWidth, viewportHeight);
  const artMini = miniArt(sidebar, barWide);

  /**
   * The measured height of everything under the cover.
   *
   * Observed rather than assumed because it changes with the episode: a title
   * that wraps to two lines is 23px taller than one that does not, and the
   * block would be centred for one episode and off for the next.
   */
  const [controlsHeight, setControlsHeight] = useState(0);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = controlsRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setControlsHeight(node.offsetHeight));
    observer.observe(node);
    setControlsHeight(node.offsetHeight);
    return () => observer.disconnect();
  }, [episode?.id, twoColumn]);

  const artOneTop = artTop(viewportHeight, artOne.size, controlsHeight);
  const artTwoTop = artTop(viewportHeight, artTwo.size, controlsHeight);

  /**
   * 0 = one column, 1 = two. The captions axis, as a number.
   *
   * A second motion value beside `expansion` rather than something folded into
   * it, because they are genuinely independent: the sheet can be opening while
   * the transcript is closing, and either can be interrupted mid-flight without
   * disturbing the other.
   *
   * `expressive` for the same reason the sheet uses it — this moves a
   * screen-sized amount of content, and the snappier presets make a change that
   * large read as a jump cut with easing applied rather than as one layout
   * becoming another.
   */
  const columns = useMotionValue(twoColumn ? 1 : 0);
  const columnSettle = useTransition('expressive');

  useEffect(() => {
    const controls = animate(columns, twoColumn ? 1 : 0, columnSettle);
    return () => controls.stop();
  }, [twoColumn, columns, columnSettle]);

  /*
    The full-state geometry, interpolated across that axis.

    These are the numbers the cover would have snapped between; as motion values
    they are the path between them instead.
  */
  const fullSize = useTransform(columns, [0, 1], [artOne.size, artTwo.size]);
  const fullStart = useTransform(columns, [0, 1], [artOne.start, artTwo.start]);
  const fullTop = useTransform(columns, [0, 1], [artOneTop, artTwoTop]);

  /** How wide the transcript column is, and the gap that opens before it. */
  const captionsWidth = useTransform(columns, [0, 1], [0, splitWidth]);
  const captionsGap = useTransform(columns, [0, 1], [0, COLUMN_GAP]);
  /* Held back until the column is wide enough to read a word in, so the text
     is not briefly legible at forty pixels wide while the gap is still
     opening. */
  const captionsOpacity = useTransform(columns, [0.35, 0.85], [0, 1]);

  /**
   * Whether the column axis has any width on it at all.
   *
   * Follows the spring rather than the intent, which is the whole point: the
   * transcript has to survive its own exit animation, and "the listener has
   * turned it off" and "it has finished closing" are half a second apart.
   *
   * `setState` with an unchanged value is a no-op in React, so this is a
   * per-frame comparison and a re-render only on the two frames that matter.
   */
  const [columnsSettled, setColumnsSettled] = useState(twoColumn);
  useMotionValueEvent(columns, 'change', (value) => {
    const open = value > 0.001;
    setColumnsSettled((was) => (was === open ? was : open));
  });

  const captionsMounted = wide ? twoColumn || columnsSettled : captionsOpen;

  const sheetY = useTransform(expansion, [0, 1], [restY, 0]);
  const scrimOpacity = useTransform(expansion, [0, 1], [0, 1]);
  const miniOpacity = useTransform(expansion, [0, 0.35], [1, 0]);
  const fullOpacity = useTransform(expansion, [0.4, 1], [0, 1]);
  /**
   * The cover's journey, as a scale and a translate.
   *
   * The element is always laid out at its full size in its full position; the
   * mini state is that same box scaled down and moved. Nothing about it touches
   * layout, so the browser rasterises the cover once and the compositor does
   * the rest.
   */
  /*
    Two axes composed into one transform, and the element itself laid out at a
    size that never changes.

    The cover is laid out at the *one-column* geometry always, and both journeys
    — mini→full and one-column→two — are expressed as scale and translate away
    from it. Animating `width`/`height` across the column change instead would
    have been simpler to write and would put an image resize on the layout and
    raster path for every frame of a half-second animation, which is the exact
    cost the note above `miniArt` exists to refuse. This keeps the whole thing
    on the compositor.
  */
  const artScale = useTransform([expansion, fullSize], ([e, size]) => {
    const mini = artMini.size / artOne.size;
    const full = (size as number) / artOne.size;
    return mini + (full - mini) * (e as number);
  });
  // Translation is physical, the layout is not: under Arabic the sheet is
  // mirrored, so the same journey in inline terms runs the other way in px.
  const artX = useTransform([expansion, fullStart], ([e, start]) => {
    const mini = (artMini.start - artOne.start) * (rtl ? -1 : 1);
    const full = ((start as number) - artOne.start) * (rtl ? -1 : 1);
    return mini + (full - mini) * (e as number);
  });
  const artY = useTransform([expansion, fullTop], ([e, top]) => {
    const mini = artMini.top - artOneTop;
    const full = (top as number) - artOneTop;
    return mini + (full - mini) * (e as number);
  });
  /**
   * Corners, corrected for the scale they are being drawn at.
   *
   * A transform scales the border radius with everything else, so an 18px
   * corner rendered at 0.12× is a 2px corner — the mini cover would come out
   * almost square. Dividing by the current scale asks for whatever radius
   * renders as the one the design system specified.
   */
  const artRadiusWanted = useTransform(expansion, [0, 1], [artMini.radius, artOne.radius]);
  const artRadius = useTransform(
    [artRadiusWanted, artScale],
    ([radius, scale]) => `${(radius as number) / (scale as number)}px`,
  );
  /**
   * The cover lifts off the page as it grows. Flat at mini size, floating at
   * full — a 48px thumbnail sitting in a bar has nothing to cast a shadow onto.
   *
   * Every length is written with a unit, including the zeros. Motion
   * interpolates these as structured values and matches the two strings term by
   * term; a bare `0` against `28px` is a different kind of term and the whole
   * shadow falls back to a hard swap at the midpoint.
   */
  const artShadow = useTransform(
    expansion,
    [0, 1],
    ['0px 0px 0px rgba(0,0,0,0)', '0px 28px 64px rgba(0,0,0,0.55)'],
  );

  const drag = useSheetDrag({
    expansion,
    travelPx: restY,
    settle,
    onCommit: (next) => {
      // Recorded before the state change so the settle effect knows the spring
      // is already running and leaves it alone.
      settledFor.current = next;
      setExpanded(next);
    },
    enabled: travel,
  });

  /**
   * This episode's own colour, fetched once it is playing.
   *
   * The show's colour — which the player already carries — is shown first and
   * this replaces it when it lands, usually within a few hundred milliseconds.
   * Asked for only while expanded: the mini bar tints one small progress line,
   * which the show's colour serves perfectly well, and there is no reason to
   * reach for a publisher's CDN for that.
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

  /* Only the backdrop uses this now. The transport was tinted with it too and
     came out muted — see `PlayPauseButton`. */
  const accentColor = tintData?.accentColor ?? episode?.accentColor ?? null;

  if (!episode) return null;

  const playing = state.status === 'playing';
  /*
    Opening a source and waiting for one mid-episode look identical from here,
    and should: both mean "pressing this will not produce sound yet". Buffering
    is a flag rather than a status precisely so this line can fold the two
    together without any of the `status === 'playing'` checks around it changing
    meaning during a stall.

    Before this, a seek into an unbuffered part of a streamed episode left the
    transport showing a pause button over as much as ten seconds of silence —
    the player claiming to be playing while the browser re-requested from a new
    byte offset.
  */
  const loading = state.status === 'loading' || state.buffering;

  /**
   * Where the artwork rests, for the path that does not travel there.
   *
   * Reduced motion resolves the column axis the same way it resolves the
   * expansion one — to whichever end it is currently at, with no journey — so
   * this reads the layout that is on screen rather than an interpolation.
   */
  const artResting = twoColumn ? { ...artTwo, top: artTwoTop } : { ...artOne, top: artOneTop };
  const art = expanded ? artResting : artMini;
  /**
   * Controls and metadata line up with the cover, as they do in Apple's window.
   *
   * The cover's width exactly, at every size. Letting the controls run wider on
   * narrow screens gave the scrubber more room and cost the thing that makes
   * the layout read as one object — a scrubber that starts and ends past the
   * edges of the cover above it is a second column, not the same one.
   *
   * A motion value now, so it tracks the cover through the column change rather
   * than snapping to the new width while the cover is still on its way there.
   */
  const columnInner = travel ? fullSize : artResting.size;

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
        style={{
          y: travel ? sheetY : expanded ? 0 : restY,
          // The sheet spans the whole window and is transparent; the mini bar
          // below paints its own surface. That is what lets the expanded player
          // cover the sidebar without the collapsed one painting over it — and
          // it is done with `pointer-events` rather than by animating `left`,
          // because `left` is a layout property and moving it every frame would
          // relayout the entire player for the length of the gesture.
          pointerEvents: expanded ? 'auto' : 'none',
        }}
        className="fixed inset-0 z-40 h-dvh overflow-hidden"
      >
        {/*
          The backdrop, behind everything in the sheet.

          Faded in with the full layout rather than always painted: at mini
          height it would be a 72px sliver of blurred cover behind a bar that
          already sits on a solid surface, which reads as a rendering fault
          rather than as atmosphere.
        */}
        <m.div
          className="absolute inset-0"
          // Promoted, because what is being faded is the most expensive thing
          // on the screen. Motion writes this opacity from JavaScript rather
          // than as a CSS animation, so the browser has no way to know in
          // advance that it is worth keeping the rasterised result — told
          // explicitly, it blurs the cover once instead of on every frame.
          style={{ opacity: fullOpacity, willChange: 'opacity' }}
        >
          <AmbientBackdrop artworkUrl={episode.artworkUrl} accentColor={accentColor} />
        </m.div>

        {/* ------------------------------------------------------- mini -- */}
        {/*
          Two players in one bar.

          On a phone it is a strip you press to open the real thing. On a
          desktop it *is* the real thing — the transport, the scrubber, speed,
          queue and volume, laid out in the three columns every desktop media
          player has used for twenty years, because that is where people's eyes
          already go. Expanding is still there for the cover and the transcript;
          it is no longer the only way to skip back fifteen seconds.

          One element rather than two, so the artwork can keep travelling
          continuously out of it and the drag gesture keeps working at both
          widths.
        */}
        <m.div
          {...drag}
          style={{
            opacity: miniOpacity,
            pointerEvents: expanded ? 'none' : 'auto',
            insetInlineStart: sidebar,
            height: miniHeight,
          }}
          /* Repainted by a page that has a ground of its own — see
             `ChromeTint`. The bar sits on the page rather than on the backdrop,
             so leaving it themed while the page behind it is navy reads as a
             strip of a different application. The expanded sheet below is
             deliberately not marked: it carries `stage`, which must not move. */
          data-chrome-tint=""
          className={[
            'absolute top-0 end-0 touch-none',
            'border-t border-[var(--color-border)] bg-[var(--color-surface-overlay)]/92 backdrop-blur-xl',
          ].join(' ')}
        >
          <div className="flex h-full items-center gap-3 px-4 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] md:gap-8 md:px-6">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={t.t('player.open')}
              aria-expanded={expanded}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-start md:flex-none"
            >
              {/* Spacer: the artwork itself is rendered once, below, so it can
                  travel continuously between the two layouts. */}
              <span
                aria-hidden="true"
                className="shrink-0"
                style={{ width: artMini.size, height: artMini.size }}
              />
              <span className="min-w-0 flex-1">
                <span className="type-body-strong clamp-1 block text-[var(--color-text-primary)]">
                  {episode.title}
                </span>
                <span className="type-caption clamp-1 block text-[var(--color-text-tertiary)]">
                  {episode.podcastTitle}
                </span>
              </span>
            </button>

            {/* --------------------------------------------- wide transport -- */}
            <div className="hidden min-w-0 flex-col items-center gap-1 md:flex">
              <div className="flex items-center gap-3">
                <SkipButton
                  direction="back"
                  seconds={SKIP_BACK_SEC}
                  onClick={actions.skipBack}
                  size={36}
                />
                <PlayPauseButton
                  playing={playing}
                  loading={loading}
                  onToggle={actions.toggle}
                  size={40}
                  variant="ink"
                />
                <SkipButton
                  direction="forward"
                  seconds={SKIP_FORWARD_SEC}
                  onClick={actions.skipForward}
                  size={36}
                />
              </div>

              {/* Capped rather than filled: a scrubber stretched across a
                  1600px window makes one pixel worth four seconds, which is
                  precision nobody asked for and a very long way for the hand to
                  travel. */}
              <div className="w-full max-w-[540px]">
                <ProgressBar
                  durationSec={state.durationSec}
                  isPlaying={playing}
                  inline
                />
              </div>
            </div>

            {/* --------------------------------------------- wide utilities -- */}
            <div className="hidden items-center justify-end gap-3 md:flex">
              {/* Anchored to its end edge: this cluster is right-aligned in
                  the bar, so a panel hanging from the start edge would open
                  across the volume slider and off the window. */}
              <SpeedControl
                rate={state.rate}
                onChange={actions.setRate}
                align="end"
                offscreen={expanded}
              />

              <Link
                href={'/queue' as Route}
                className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-[var(--color-surface-hover)] px-3.5 type-caption text-[var(--color-text-secondary)] no-underline transition-colors hover:text-[var(--color-text-primary)]"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d={icon.queue} />
                </svg>
                {t.t('nav.queue')}
              </Link>

              <div className="w-[132px] shrink-0">
                <VolumeSlider volume={state.volume} onChange={actions.setVolume} />
              </div>

              {/* Last, on the outside edge — the position every window's close
                  control has, and far enough from the volume track that a drag
                  overshooting the end of the level cannot land on it. */}
              <DismissButton onClick={actions.dismiss} label={t.t('player.dismiss')} />
            </div>

            {/* ------------------------------------------- narrow transport -- */}
            <div className="flex items-center gap-1 md:hidden">
              <SkipButton direction="back" seconds={SKIP_BACK_SEC} onClick={actions.skipBack} />
              <PlayPauseButton
                playing={playing}
                loading={loading}
                onToggle={actions.toggle}
                size={40}
                variant="ink"
              />
              <DismissButton onClick={actions.dismiss} label={t.t('player.dismiss')} />
            </div>
          </div>

          {/* The hairline of progress along the floor, for the width that has
              no room for a real scrubber. Above `md` the bar has one. */}
          <div className="absolute inset-x-0 bottom-0 px-4 md:hidden">
            <ProgressBar durationSec={state.durationSec} isPlaying={playing} compact />
          </div>
        </m.div>

        {/* ------------------------------------------------------- full -- */}
        {/*
          Painted white, whatever the theme is and whatever is playing.

          `AmbientBackdrop` is a fixed dark ground on purpose — blurred cover,
          tint wash, black scrim — so that legibility never depends on which
          cover happens to be playing. The foreground was not. It read the
          ordinary theme tokens, so in the light theme this entire sheet
          rendered `#17140F` text on that dark ground: title, show name,
          timecodes, transport glyphs and the captions panel all present,
          correct, and invisible.

          Pointing it at `dark` fixed the invisibility and left a subtler
          version of the same fault. `dark`'s text is `#F1EAD9` — a warm cream,
          correct on warm paper, and on a backdrop taken from the artwork it
          reads as *tinted by the cover*: cream over a brown cover, faintly
          green over a green one. The colour of the words appeared to depend on
          the picture behind them, which is the one thing this screen must never
          do. `stage` is the neutral white answer; see its note in the design
          tokens.

          Re-declaring the colour variables here re-points every descendant at
          once, including components added later, without any of them knowing
          the sheet is special. The mini bar is a sibling rather than a child
          precisely so it keeps following the theme — it sits on the page, not
          on the backdrop.
        */}
        <m.div
          style={{
            ...colorVarStyle(stage),
            opacity: fullOpacity,
            pointerEvents: expanded ? 'auto' : 'none',
          }}
          className="absolute inset-0 flex h-full flex-col"
        >
          {/* The drag surface, and the only affordance saying this sheet moves.
              Deliberately not the whole sheet: the captions beside it are a
              scroll container, and claiming every touch for the drag is what
              stopped them being scrollable by finger at all. */}
          <div {...drag} className="flex shrink-0 touch-none justify-center pt-3 pb-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={t.t('player.close')}
              className="flex h-8 w-16 cursor-pointer items-center justify-center border-0 bg-transparent"
            >
              <span className="block h-1 w-10 rounded-full bg-[var(--color-border-strong)]" />
            </button>
          </div>

          <div
            // The slot that reserves space for the cover is the first thing in
            // this row, so the row has to begin exactly where the cover does —
            // the padding is derived from the same number rather than written
            // twice.
            style={{ paddingTop: (travel ? artOneTop : artResting.top) - HEADER_H }}
            className={[
              'flex min-h-0 flex-1 px-6 pb-8',
              wide ? 'flex-row items-stretch' : 'flex-col items-center',
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
              {/* Artwork slot — the real artwork sits above this, travelling.
                  Sized from the same motion value the cover is, so the column
                  under it reflows in step with the cover rather than jumping to
                  the new width a spring ahead of it. */}
              <m.div
                aria-hidden="true"
                style={
                  travel
                    ? { height: fullSize, width: fullSize }
                    : { height: artResting.size, width: artResting.size }
                }
                className="shrink-0"
              />

              {/*
                Everything below the cover shares the cover's width.

                This is the structural move that makes Apple's window read as
                one object rather than a stack of centred rows: the title, the
                scrubber, the transport and the volume all begin and end on the
                cover's edges, so the eye has a single column to follow.
              */}
              <m.div ref={controlsRef} className="mt-7 w-full" style={{ maxWidth: columnInner }}>
                {/* Title on the start edge, not centred. Centred metadata under
                    a left-aligned column re-centres on every episode as the
                    title length changes, which is visible as drift. */}
                <div className="min-w-0">
                  <h2 className="type-title3 clamp-2 m-0 text-[var(--color-text-primary)]">
                    {episode.title}
                  </h2>
                  <p className="type-callout clamp-1 mt-0.5 mb-0 text-[var(--color-text-secondary)]">
                    {episode.podcastTitle}
                  </p>
                </div>

                <div className="mt-5">
                  <ProgressBar durationSec={state.durationSec} isPlaying={playing} />
                </div>

                {/* Transport. Bare glyphs on the backdrop, evenly spaced across
                    the column rather than bunched in the middle. */}
                <div className="mt-4 flex items-center justify-center gap-10">
                  <SkipButton
                    direction="back"
                    seconds={SKIP_BACK_SEC}
                    onClick={actions.skipBack}
                    size={52}
                  />
                  <PlayPauseButton
                    playing={playing}
                    loading={loading}
                    onToggle={actions.toggle}
                    size={64}
                    variant="bare"
                  />
                  <SkipButton
                    direction="forward"
                    seconds={SKIP_FORWARD_SEC}
                    onClick={actions.skipForward}
                    size={52}
                  />
                </div>

                <div className="mt-5">
                  <VolumeSlider volume={state.volume} onChange={actions.setVolume} />
                </div>

                {/* The utility row, on the floor of the column: speed on the
                    start edge, the two destinations on the other. */}
                <div className="mt-5 flex items-center justify-between">
                  <SpeedControl
                    rate={state.rate}
                    onChange={actions.setRate}
                    offscreen={!expanded}
                  />

                  <div className="flex items-center gap-1">
                    {/* At both widths now. Two columns previously offered no
                        way to turn the transcript off, which left anyone who
                        just wanted to look at the cover stuck with it. */}
                    <IconButton
                      label={captionsOpen ? t.t('captions.hide') : t.t('captions.show')}
                      path={icon.captions}
                      pressed={captionsOpen}
                      onClick={() => setCaptionsChoice(!captionsOpen)}
                    />

                    <IconButton
                      label={t.t('player.openQueue')}
                      path={icon.queue}
                      href={'/queue' as Route}
                      onClick={() => setExpanded(false)}
                    />
                  </div>
                </div>
              </m.div>

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
                    className="type-callout mt-5 mb-0 text-center text-[var(--color-danger)]"
                  >
                    {state.error}
                  </m.p>
                ) : null}
              </AnimatePresence>
            </div>

            {/* ------------------------------------------ captions column -- */}
            {/*
              Kept mounted through its own closing animation.

              In two columns this column *is* the animation — its width is what
              the cover is making room for — so unmounting it the instant the
              control is pressed would collapse the layout on one frame and
              leave the cover gliding into a space that had already closed.
              `columnsSettled` follows the spring rather than the intent, so the
              transcript leaves only once it has finished narrowing to nothing.
            */}
            {captionsMounted ? (
              <m.div
                className={[
                  'flex min-h-0 flex-col',
                  // Clipped while narrowing: the transcript keeps its own
                  // reading measure, so without this the text would spill out
                  // of a column that is on its way to zero.
                  wide ? 'shrink-0 overflow-hidden' : 'w-full flex-1',
                ].join(' ')}
                style={
                  wide && travel
                    ? {
                        width: captionsWidth,
                        marginInlineStart: captionsGap,
                        opacity: captionsOpacity,
                      }
                    : undefined
                }
              >
                {/* In one column the utility row is on the other screen, so the
                    way back has to be here. In two it is always visible below
                    the cover and a second copy would be clutter. */}
                {!wide ? (
                  <div className="mb-1 flex shrink-0 justify-end">
                    <IconButton
                      label={t.t('captions.hide')}
                      path={icon.captions}
                      pressed
                      onClick={() => setCaptionsChoice(false)}
                    />
                  </div>
                ) : null}

                {/* Keyed on the episode so switching tracks resets the scroll
                    rather than leaving the new transcript parked mid-way down
                    where the last one happened to be.

                    Centred when the captions have the screen to themselves. The
                    column keeps its reading measure either way, so on a window
                    wider than the measure the choice is only where the leftover
                    space goes — and all of it on one side reads as a column
                    that failed to fill rather than one that was placed. Beside
                    the artwork it stays on the start edge, which is where the
                    eye arrives from. */}
                <Captions
                  key={episode.id}
                  episodeId={episode.id}
                  className={['min-h-0 flex-1', wide ? '' : 'mx-auto'].join(' ')}
                  // Pinned to the column's final width while it animates, so
                  // the lines inside do not re-wrap on every frame of the
                  // opening — reflowing a transcript sixty times is both the
                  // expensive way to do this and a visibly unsteady one.
                  {...(wide ? { style: { width: splitWidth } } : {})}
                />
              </m.div>
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
            // `!wide`, not `!twoColumn`: in two columns the cover and the
            // transcript coexist, so the only case that withdraws the cover is
            // the narrow one where the transcript has taken the whole screen.
            !wide && captionsOpen ? 'hidden' : '',
          ].join(' ')}
          style={
            travel
              ? {
                  /*
                    Laid out once, at the *one-column* size and position, and
                    never relaid out again.

                    Both journeys — mini to full, and one column to two — are
                    transforms away from this box, so the element's own layout
                    is a constant for a given window size. That is what keeps
                    the cover on the compositor through both animations.
                  */
                  width: artOne.size,
                  height: artOne.size,
                  insetInlineStart: artOne.start,
                  top: artOneTop,
                  // Scaling about the inline-start corner is what makes the
                  // translate above a straight offset between the two corners
                  // rather than a scale-dependent one.
                  transformOrigin: rtl ? 'top right' : 'top left',
                  scale: artScale,
                  x: artX,
                  y: artY,
                  borderRadius: artRadius,
                  boxShadow: artShadow,
                }
              : {
                  // Same endpoints, no journey: the cover is simply the right
                  // size in the right place for the state the player is in.
                  width: art.size,
                  height: art.size,
                  borderRadius: art.radius,
                  insetInlineStart: art.start,
                  top: art.top,
                }
          }
        >
          {/* `fill` so the animated wrapper owns the dimensions. Requesting the
              large resolution means the image is already sharp when expanded
              rather than upscaling as it grows. */}
          <Artwork src={episode.artworkUrl} alt={episode.podcastTitle} size={400} fill />
        </m.div>
      </m.div>
    </>
  );
}

/**
 * Close the player.
 *
 * The mini bar is permanent once anything has played — it is how playback
 * survives navigation — and until now that meant permanently, with no way to
 * put it away short of reloading the page. On a phone it is a strip across the
 * bottom of every screen; on a desktop it is 84px of every window. Somebody who
 * has finished listening should be able to say so.

 * A cross rather than a stop button, and quiet rather than prominent: it
 * removes a piece of chrome, it does not destroy anything. The position is
 * saved on the way out and the queue is left alone, so pressing it is
 * recoverable — which is the only reason it can be this small.
 */
function DismissButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M6 6 18 18M18 6 6 18" />
      </svg>
    </button>
  );
}

/**
 * A round icon control.
 *
 * Renders as a link when it goes somewhere and a button when it does something,
 * because that distinction is the difference between a control a keyboard user
 * can open in a new tab and one they cannot.
 */
function IconButton({
  label,
  path,
  onClick,
  pressed,
  href,
}: {
  label: string;
  path: string;
  onClick: () => void;
  pressed?: boolean;
  href?: Route;
}) {
  const press = usePressScale(0.86);
  const transition = useTransition('responsive');

  const className = [
    'flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 no-underline',
    'transition-colors',
    pressed
      ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
      : 'bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
  ].join(' ');

  const glyph = (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );

  if (href) {
    return (
      <m.div whileTap={{ scale: press }} transition={transition} className="flex">
        <Link href={href} aria-label={label} onClick={onClick} className={className}>
          {glyph}
        </Link>
      </m.div>
    );
  }

  return (
    <m.button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      whileTap={{ scale: press }}
      transition={transition}
      className={className}
    >
      {glyph}
    </m.button>
  );
}
