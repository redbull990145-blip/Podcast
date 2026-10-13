'use client';

import {
  PLAYBACK_RATES,
  RATE_MAX,
  RATE_MIN,
  RATE_STEP,
  type PlaybackRate,
} from '@cue/core';
import { duration } from '@cue/motion';
import * as m from 'motion/react-m';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslator } from '@/components/i18n/locale-provider';
import { usePressScale, useTransition } from '@/lib/motion';
import { useModalSheet } from '@/lib/modal-sheet';

/**
 * Playback speed.
 *
 * This was a button that cycled through eight speeds, on the reasoning that
 * speed is set once and a menu is more interaction than the decision deserves.
 * The reasoning held for the first press and broke on the rest: reaching 0.8
 * from 1 meant seven presses through every other speed, each one *audibly
 * applied* to whatever was playing, so the way to slow an episode down was to
 * make it briefly unintelligible. A control that has to be pressed repeatedly
 * is also a control that cannot be aimed — there is no way to go directly
 * anywhere, and no way to see where you could go.
 *
 * So: a panel. The eight presets stay, because one press is still the right
 * cost for the common case, and they are laid out as a grid you read rather
 * than a sequence you traverse. Underneath them is the slider, for the people
 * the presets were failing — anyone who has settled on 1.85 and can hear the
 * difference between that and 2.
 *
 * Both write through immediately. There is no Apply, and there should not be:
 * the thing being adjusted is playing out loud while you adjust it, so the
 * audio *is* the preview, and a confirm step would put a dialog between
 * somebody and the only feedback that matters.
 */

/** How far above the trigger the panel floats. */
const PANEL_GAP = 8;
/** Four presets across at a comfortable chip width, plus the panel's padding. */
const PANEL_WIDTH = 236;

export function SpeedControl({
  rate,
  onChange,
  /**
   * Which edge the panel hangs from.
   *
   * It opens upward everywhere — this control lives at the bottom of the window
   * in both layouts — but horizontally it has to hang from whichever edge has
   * room. In the desktop bar the button sits in a right-aligned cluster, so a
   * panel anchored to its start edge runs off the window.
   */
  align = 'start',
  offscreen = false,
}: {
  rate: PlaybackRate;
  onChange: (rate: PlaybackRate) => void;
  align?: 'start' | 'end';
  /**
   * This control is no longer on screen.
   *
   * The player keeps both of its speed controls mounted — the mini bar and the
   * expanded sheet are one component, and the transition between them animates
   * opacity rather than swapping trees. So the mini bar's control does not
   * unmount when the sheet opens; it becomes invisible and untouchable while
   * anything it portalled stays exactly where it was, painted in the mini bar's
   * palette, floating over the full player.
   */
  offscreen?: boolean;
}) {
  const t = useTranslator();
  const [open, setOpen] = useState(false);
  const press = usePressScale(0.9);
  const transition = useTransition('responsive');

  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back where it came from. Closing a panel and leaving focus on
    // `<body>` drops a keyboard user at the top of the document, which on this
    // screen means starting the whole page again.
    buttonRef.current?.focus();
  }, []);

  /*
    Closed without moving focus, unlike every other way this closes.

    Focus is *why* this is a separate path. The player expanding is not the
    reader dismissing a menu — they are looking at the sheet that just opened,
    and pulling focus back to a button that is now invisible would take the next
    Tab to somewhere off screen.
  */
  useEffect(() => {
    if (offscreen) setOpen(false);
  }, [offscreen]);

  useDismissOnOutside([buttonRef, panelRef], open, close);

  return (
    <div className="flex">
      <m.button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label={t.t('player.speedOpen', { rate: format(rate) })}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        whileTap={{ scale: press }}
        transition={transition}
        className={[
          'h-9 min-w-11 shrink-0 cursor-pointer rounded-full border-0 px-3 type-caption',
          'transition-colors',
          open
            ? 'bg-[var(--color-surface-pressed)] text-[var(--color-text-primary)]'
            : 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
        ].join(' ')}
      >
        {format(rate)}×
      </m.button>

      <AnimatePresence>
        {open ? (
          <SpeedPanel
            panelRef={panelRef}
            id={panelId}
            rate={rate}
            align={align}
            anchor={buttonRef}
            onChange={onChange}
            onClose={close}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * The panel, rendered into `<body>` rather than beside its button.
 *
 * Not a preference. Both places this control appears are inside the player
 * sheet, which is `overflow-hidden` — it has to be, because the sheet is a
 * full-height element translated below the fold and anything escaping it would
 * paint over the page. The mini bar sits at the sheet's *top* edge, so a panel
 * positioned `bottom: 100%` opens into exactly the region that clipping
 * removes: it rendered, it was laid out correctly, and it was invisible.
 *
 * A portal takes it out of that stacking and clipping context entirely, which
 * means the position has to be computed rather than inherited — see `place`.
 */
function SpeedPanel({
  id,
  rate,
  align,
  anchor,
  panelRef,
  onChange,
  onClose,
}: {
  id: string;
  rate: PlaybackRate;
  align: 'start' | 'end';
  /** The button this hangs off, measured rather than laid out against. */
  anchor: React.RefObject<HTMLButtonElement | null>;
  /**
   * Handed down as an ordinary prop rather than through `forwardRef`.
   *
   * React 19 passes `ref` to function components like any other prop, so the
   * wrapper only exists to give the parent's outside-click check something to
   * test against — and naming it plainly is clearer than a forwarded ref whose
   * only consumer is one `contains()` call.
   */
  panelRef: React.RefObject<HTMLDivElement | null>;
  onChange: (rate: PlaybackRate) => void;
  onClose: () => void;
}) {
  const t = useTranslator();
  const settle = useTransition('snappy');
  const [position, setPosition] = useState<React.CSSProperties | null>(null);

  /*
    Measured in a layout effect, before the browser paints.

    A plain effect runs after paint, so the panel would appear for one frame at
    the top-left of the window and then jump to the button — a flash that reads
    as a rendering fault on a control people open and close repeatedly.
  */
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;

      /*
        `align` is logical and this is physical, so it is resolved here rather
        than by leaving `start-0`/`end-0` to the stylesheet — a portal into
        `<body>` still inherits `dir`, but the *anchor* is a measured rectangle
        in viewport coordinates and inline offsets cannot describe it.

        Clamped to the viewport, because "hang from the button's end edge" stops
        being right the moment the button is within 236px of the window edge.
      */
      const preferred =
        align === 'end' ? rect.right - PANEL_WIDTH : rect.left;
      const left = Math.min(
        Math.max(PANEL_GAP, preferred),
        Math.max(PANEL_GAP, window.innerWidth - PANEL_WIDTH - PANEL_GAP),
      );

      setPosition({
        position: 'fixed',
        left,
        // Opens upward, always: this control is within 90px of the bottom of
        // the window in both layouts, and there is never room below it.
        bottom: window.innerHeight - rect.top + PANEL_GAP,
        width: PANEL_WIDTH,
      });
    };

    place();

    // The rail folding and the window resizing both move the button without
    // the panel hearing about it, and a menu detached from its trigger is
    // worse than one that closed.
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, align]);

  /*
    Focus moves in on open.

    Without it the panel is visible and unreachable: the next Tab from the
    trigger goes to whatever follows the button in the document, which is the
    queue link — so a keyboard user opens a speed panel and lands somewhere
    else entirely, with an open panel behind them they cannot get into.
  */
  useModalSheet({ open: true, onClose, containerRef: panelRef });

  return createPortal(
    <m.div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={t.t('player.speed')}
      // Escape closes from anywhere inside, including from the slider — the
      // one control people will still be holding when they decide they are done.
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      /*
        Snappy, with the fade pulled out of it. A small panel appearing where
        the eye already is should settle near-instantly — anything slower reads
        as lag on a control people open and close repeatedly — and opacity rides
        a plain tween because springs move things and tweens fade things: the
        spring would overshoot past 1, the compositor clamps, and the entry
        flickers. Routing both through `useTransition` also means reduced-motion
        users get the policy's short tween instead of this panel scaling and
        sliding regardless of their setting.
      */
      transition={{ ...settle, opacity: { duration: duration.fast / 1000 } }}
      className={[
        'z-50 rounded-[var(--radius-lg)] p-3',
        'border border-[var(--color-border)] bg-[var(--color-surface-overlay)]',
        'shadow-[var(--elevation-lg)] backdrop-blur-xl',
      ].join(' ')}
      style={{
        ...position,
        transformOrigin: `bottom ${align === 'end' ? 'right' : 'left'}`,
        /*
          The panel leaves the player's subtree, so it also leaves the palette
          declared on it — `stage` in the expanded sheet. Re-reading the ambient
          theme would put light-theme tokens on a panel floating over a black
          backdrop. Inheriting from the trigger is not possible across a portal,
          so the variables are copied from the button's computed style.
        */
        ...inheritedPalette(anchor.current),
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <SpeedScale rate={rate} onChange={onChange} onPick={onClose} autoFocus />
    </m.div>,
    document.body,
  );
}

/**
 * Carry the trigger's colour tokens across the portal.
 *
 * Custom properties inherit through the *DOM* tree, and a portal moves the
 * panel to `<body>` — so a panel opened from the expanded player, whose sheet
 * re-declares the whole palette as `stage`, would arrive at the body painting
 * itself in whatever theme the app is in. In the light theme that is a cream
 * panel with black text floating over a black player.
 *
 * Reading the resolved values off the button is the cheap fix and the honest
 * one: whatever the button is painted in is by definition the palette this
 * panel belongs to.
 */
function inheritedPalette(anchor: HTMLElement | null): Record<string, string> {
  if (!anchor) return {};

  const computed = window.getComputedStyle(anchor);
  const vars: Record<string, string> = {};

  for (const name of PALETTE_VARS) {
    const value = computed.getPropertyValue(name);
    if (value) vars[name] = value;
  }

  return vars;
}

/** The tokens this panel actually paints with. */
const PALETTE_VARS = [
  '--color-surface-overlay',
  '--color-surface-hover',
  '--color-surface-pressed',
  '--color-border',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-accent',
  '--color-accent-text',
  '--color-accent-muted',
] as const;

/**
 * The scale itself: eight presets and a slider under them.
 *
 * Separate from the panel because Settings needs exactly this and nothing
 * around it. Settings previously offered the eight presets as a radio group,
 * which stopped being able to describe the state the moment the player could
 * produce a speed that is not one of the eight — a listener on 1.85 would open
 * Settings and find *nothing* selected, with no way to tell whether the app had
 * forgotten their preference or simply could not draw it.
 */
export function SpeedScale({
  rate,
  onChange,
  onPick,
  autoFocus = false,
}: {
  rate: PlaybackRate;
  onChange: (rate: PlaybackRate) => void;
  /** Called when a preset is chosen, so a popover can close itself. */
  onPick?: () => void;
  autoFocus?: boolean;
}) {
  const t = useTranslator();

  return (
    <>
      {/*
        The presets, as a grid.

        Four across rather than a single row: eight chips in a line is a 480px
        panel, and at that width it stops being a menu hanging off a button and
        becomes a bar of its own. Reading order still runs slowest to fastest,
        so the grid is a scale you scan rather than a set you search.
      */}
      <div
        role="group"
        aria-label={t.t('player.speedPresets')}
        className="grid grid-cols-4 gap-1.5"
      >
        {PLAYBACK_RATES.map((preset) => {
          const active = Math.abs(preset - rate) < RATE_STEP / 2;

          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              // The first preset takes focus on open, so the panel is arrow-
              // and tab-navigable from its own start rather than from the
              // document's.
              {...(autoFocus && preset === PLAYBACK_RATES[0]
                ? { 'data-autofocus': true }
                : {})}
              onClick={() => {
                onChange(preset);
                // A preset is a decision, so the panel gets out of the way. The
                // slider below deliberately does not close — it is an
                // adjustment, and adjusting is something you do more than once.
                onPick?.();
              }}
              className={[
                'flex h-9 cursor-pointer items-center justify-center rounded-[var(--radius-md)]',
                'type-caption border transition-colors',
                'transition-transform duration-[var(--duration-instant)] ease-standard active:scale-[0.96] motion-reduce:active:scale-100',
                active
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]'
                  : 'border-transparent bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
              ].join(' ')}
            >
              {format(preset)}×
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="type-caption text-[var(--color-text-tertiary)]">
            {t.t('player.speedFine')}
          </span>
          {/* Monospace, because this number changes while the thumb moves and a
              proportional 1.75 is a different width from 1.85 — so the label
              would shuffle sideways under the finger dragging it. */}
          <span className="font-mono type-caption tabular-nums text-[var(--color-text-primary)]">
            {format(rate)}×
          </span>
        </div>

        <input
          type="range"
          min={RATE_MIN}
          max={RATE_MAX}
          step={RATE_STEP}
          value={rate}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={t.t('player.speedFine')}
          // The announced value is the speed, not the raw number — "one point
          // seven five" is a quantity, "1.75×" is a speed.
          aria-valuetext={`${format(rate)}×`}
          /*
            A native range rather than the pointer-driven slider the volume
            control uses.

            Volume has to be a custom control because it is a bare track with no
            thumb until you touch it, and because it lives in a bar that is also
            a drag handle for the sheet. Neither applies here, and a native range
            arrives with keyboard stepping, page-up/page-down, touch targets and
            screen-reader announcement already correct — all of which the custom
            one had to be given by hand.
          */
          className="h-9 w-full cursor-pointer appearance-none bg-transparent"
          style={{ accentColor: 'var(--color-accent)' }}
        />

        {/* The ends of the scale, so the track says what it spans without
            anyone having to drag to a stop to find out. */}
        <div
          aria-hidden="true"
          className="flex justify-between type-caption text-[var(--color-text-tertiary)]"
        >
          <span>{format(RATE_MIN)}×</span>
          <span>{format(RATE_MAX)}×</span>
        </div>
      </div>
    </>
  );
}

/**
 * Close when the next press lands outside.
 *
 * `pointerdown`, not `click`. A click fires after the press *completes*, so a
 * drag that starts inside the panel and finishes outside it counts as an
 * outside click — which is exactly what happens every time somebody drags the
 * slider thumb past the edge of a 236px panel, closing it mid-adjustment.
 */
function useDismissOnOutside(
  /**
   * Both the trigger and the panel, because the panel is portalled out of the
   * trigger's subtree — a single containment check against the wrapper would
   * treat every click *inside the panel* as an outside click and close it on
   * the first preset pressed.
   */
  refs: React.RefObject<HTMLElement | null>[],
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!refs.some((ref) => ref.current?.contains(target))) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
    // `refs` is a fresh array literal on every render by construction, so it is
    // deliberately not a dependency — the refs inside it are stable for the
    // component's life, and listing the array would tear these listeners down
    // and rebuild them on every render.
  }, [active, onDismiss]);
}

/**
 * A speed as people write it: `1`, `1.5`, `1.75` — never `1.0` or
 * `1.7500000000000002`.
 *
 * The float is unavoidable. The slider steps in twentieths, and a twentieth is
 * not representable in binary, so the value arriving here is routinely a few
 * digits past what anyone meant. Rounding at the display rather than in the
 * state is deliberate: the stored value has to stay a real number the audio
 * element can use, and only the label has to be readable.
 */
function format(rate: number): string {
  return String(Number(rate.toFixed(2)));
}
