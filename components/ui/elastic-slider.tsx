"use client";

import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { SPRING, TWEEN } from "@/lib/motion/config";
import { cn } from "@/lib/utils";

/**
 * Slider that stretches when you drag past either end, then springs back.
 *
 * Adapted from React Bits' ElasticSlider. The elastic overflow is the whole
 * point of it and is preserved; what changed is everything about how it is
 * driven, because the reference implementation re-renders on every pointer
 * event and that is visible as lag under the cursor.
 *
 * Nothing here renders during a drag. The value lives in a motion value, the
 * fill width and the readout are derived from it, and `aria-valuenow` is
 * written straight to the node — so a pointer move costs one style write and no
 * React work at all. The only renders are the ones that change what is on
 * screen structurally: crossing into or out of an overflow region.
 *
 * Colour is inherited via `currentColor`, so a caller sets tone with a `text-*`
 * class on the wrapper.
 */

const MAX_OVERFLOW = 50;

/**
 * How much the control grows while the pointer is over it.
 *
 * The reference used 1.2, which is a fifth again the size and reads as the
 * widget jumping at you. Apple's volume sliders barely scale at all — what
 * actually changes is the *track*, which roughly doubles in thickness, and the
 * surrounding growth is small enough that you register it as the control waking
 * up rather than as movement. So: a few percent of scale, and let the track
 * carry the change.
 */
const HOVER_SCALE = 1.04;
const TRACK_REST = 6;
const TRACK_HOVER = 10;

function decay(value: number, max: number): number {
  if (max === 0) return 0;
  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}

export function ElasticSlider({
  defaultValue = 50,
  startingValue = 0,
  maxValue = 100,
  isStepped = false,
  stepSize = 1,
  leftIcon,
  rightIcon,
  onChange,
  className,
  ariaLabel = "Slider",
  formatValue,
  showValue = true,
}: {
  defaultValue?: number;
  startingValue?: number;
  maxValue?: number;
  isStepped?: boolean;
  stepSize?: number;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  onChange?: (value: number) => void;
  className?: string;
  ariaLabel?: string;
  /** Spoken form of the value, e.g. `(v) => `${Math.round(v)}%``. */
  formatValue?: (value: number) => string;
  showValue?: boolean;
}) {
  /*
   * `MotionConfig reducedMotion="user"` does not reach this component. It gates
   * animation *props* on `motion.*` elements, and everything here is driven
   * through motion values that this file sets directly — so the preference has
   * to be read and applied by hand, the way captions-panel and animated-artwork
   * already do.
   *
   * Opacity is deliberately left alone. Motion's own reduced-motion behaviour
   * keeps fades, and the value readout is information rather than decoration —
   * hiding it would remove feedback, not motion.
   */
  const reduceMotion = useReducedMotion() ?? false;

  const sliderRef = useRef<HTMLDivElement>(null);
  const clientX = useMotionValue(0);
  const overflow = useMotionValue(0);
  const scale = useMotionValue(1);
  /** The live value. Owned by Motion so a drag never waits for React. */
  const progress = useMotionValue(defaultValue);
  /*
   * How visible the readout is. Fades in on pointerdown and out on pointerup.
   * A motion value rather than state so it never puts a render on the drag —
   * and so the fade tweens rather than snapping the way an `opacity-0` /
   * `opacity-100` class swap would.
   */
  const readout = useMotionValue(0);

  /**
   * Which end is being pulled: -1 left, 0 neither, 1 right.
   *
   * A motion value rather than React state, which is what the reference used.
   * The icons and the track's transform origin all need it, and putting it in
   * state meant a render every time the pointer crossed an end — mid-drag,
   * which is the one moment there is no spare frame for one.
   */
  const overflowDirection = useMotionValue(0);
  const draggingRef = useRef(false);

  /*
   * The track's box, measured once per drag rather than per frame.
   *
   * `getBoundingClientRect` forces the browser to flush layout, and the
   * reference called it from inside two `useTransform` callbacks — so it ran on
   * every animation frame of both the drag and the spring-back, twice. The box
   * cannot change mid-drag, so measuring it on pointer-down is both cheaper and
   * more correct.
   */
  const rectRef = useRef<DOMRect | null>(null);
  const measure = () => {
    const node = sliderRef.current;
    if (node) rectRef.current = node.getBoundingClientRect();
    return rectRef.current;
  };

  const range = maxValue - startingValue;

  /*
   * Publish the value to assistive tech without rendering.
   *
   * `aria-valuenow` has to stay accurate, but routing it through React state
   * would put a render on the hot path purely to update an attribute nothing
   * paints. Writing it to the node directly keeps the drag free of React
   * entirely while leaving the semantics exactly as correct.
   */
  useMotionValueEvent(progress, "change", (latest) => {
    const node = sliderRef.current;
    if (!node) return;
    node.setAttribute("aria-valuenow", String(Math.round(latest)));
    if (formatValue) node.setAttribute("aria-valuetext", formatValue(latest));
  });

  // External changes — mute, a reset, another surface moving the same value.
  // Ignored mid-drag: the parent typically feeds back a rounded copy of what we
  // just sent it, and letting that land would quantise the fill under the
  // cursor into visible steps.
  useEffect(() => {
    if (draggingRef.current) return;
    progress.jump(defaultValue);
  }, [defaultValue, progress]);

  useMotionValueEvent(clientX, "change", (latest) => {
    const rect = rectRef.current;
    if (!rect) return;
    let past: number;
    if (latest < rect.left) {
      overflowDirection.set(-1);
      past = rect.left - latest;
    } else if (latest > rect.right) {
      overflowDirection.set(1);
      past = latest - rect.right;
    } else {
      overflowDirection.set(0);
      past = 0;
    }
    // The rubber-band stretch is pure decoration — it says nothing the value
    // does not already say — so it is the first thing to go.
    overflow.jump(reduceMotion ? 0 : decay(past, MAX_OVERFLOW));
  });

  const commit = (next: number) => {
    const clamped = Math.min(Math.max(next, startingValue), maxValue);
    progress.set(clamped);
    onChange?.(clamped);
    return clamped;
  };

  const valueFromPointer = (x: number) => {
    const rect = rectRef.current;
    if (!rect || rect.width === 0) return progress.get();
    let next = startingValue + ((x - rect.left) / rect.width) * range;
    if (isStepped) next = Math.round(next / stepSize) * stepSize;
    return next;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0 || !draggingRef.current) return;
    commit(valueFromPointer(e.clientX));
    clientX.jump(e.clientX);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    measure();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    animate(readout, 1, TWEEN.fast);
    commit(valueFromPointer(e.clientX));
    clientX.jump(e.clientX);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
    animate(readout, 0, TWEEN.normal);

    // Nothing stretched, so there is nothing to spring back from.
    if (reduceMotion) {
      overflowDirection.set(0);
      return;
    }

    // `SPRING.pop` rather than the reference's inline `{ bounce: 0.5,
    // duration: 0.6 }`: 600ms is slower than every token the app defines, and a
    // visible bounce is what config.ts's spring notes call the line between
    // "alive" and "toy-like". This is also the spring the volume popover itself
    // opens on, so the control and its container settle as one material.
    animate(overflow, 0, SPRING.pop).then(() => {
      overflowDirection.set(0);
    });
  };

  /*
   * Keyboard control.
   *
   * The slider this replaced was a native `<input type="range">` painted over,
   * which meant arrow keys came free. A `role="slider"` div gets none of that,
   * so the bindings a range input implements are reproduced here — otherwise
   * swapping in the elastic version would have quietly made volume
   * mouse-only.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = isStepped ? stepSize : Math.max(range / 100, 0.01);
    const page = step * 10;
    const current = progress.get();
    let next: number | null = null;

    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = current - step;
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = current + step;
        break;
      case "PageDown":
        next = current - page;
        break;
      case "PageUp":
        next = current + page;
        break;
      case "Home":
        next = startingValue;
        break;
      case "End":
        next = maxValue;
        break;
      default:
        return;
    }

    e.preventDefault();
    commit(next);

    // Show the readout for a beat so a keyboard adjustment is visible too,
    // then fade back out.
    readout.set(1);
    if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
    keyboardTimer.current = setTimeout(() => {
      animate(readout, 0, TWEEN.normal);
    }, 900);
  };

  const keyboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (keyboardTimer.current) clearTimeout(keyboardTimer.current);
  }, []);

  const trackScaleX = useTransform(() => {
    const width = rectRef.current?.width ?? 0;
    return width === 0 ? 1 : 1 + overflow.get() / width;
  });
  const trackScaleY = useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]);
  const trackOrigin = useTransform(() =>
    overflowDirection.get() < 0 ? "right" : "left",
  );
  const trackHeight = useTransform(scale, [1, HOVER_SCALE], [TRACK_REST, TRACK_HOVER]);
  const trackMargin = useTransform(
    scale,
    [1, HOVER_SCALE],
    [0, -(TRACK_HOVER - TRACK_REST) / 2],
  );
  const wrapperOpacity = useTransform(scale, [1, HOVER_SCALE], [0.72, 1]);

  /*
   * Each icon is pushed, and swells, only while its own end is the one being
   * pulled — and is divided by the wrapper's scale so it travels the same
   * on-screen distance whatever the hover growth is doing.
   *
   * The reference fired a canned `[1, 1.4, 1]` keyframe pulse when the region
   * changed, which plays at a fixed speed regardless of how hard you are
   * pulling and finishes while you are still pulling. Reading the overflow
   * directly ties the swell to the gesture, so it grows as you push into the
   * end and relaxes with the spring on release.
   */
  const leftIconX = useTransform(() =>
    overflowDirection.get() < 0 ? -overflow.get() / scale.get() : 0,
  );
  const rightIconX = useTransform(() =>
    overflowDirection.get() > 0 ? overflow.get() / scale.get() : 0,
  );
  const leftIconScale = useTransform(() =>
    overflowDirection.get() < 0 ? 1 + (overflow.get() / MAX_OVERFLOW) * 0.3 : 1,
  );
  const rightIconScale = useTransform(() =>
    overflowDirection.get() > 0 ? 1 + (overflow.get() / MAX_OVERFLOW) * 0.3 : 1,
  );

  /*
   * `scaleX` rather than `width` for the fill. Width is a layout property, so
   * setting it per frame runs layout + paint on the whole slider each time;
   * scaleX runs only on the compositor. That is the difference between the
   * drag animating on the render thread and animating on the GPU, and it is
   * the last real jitter source on a slower machine.
   */
  const fillScaleX = useTransform(progress, (p) =>
    range === 0 ? 0 : (p - startingValue) / range,
  );
  const valueText = useTransform(progress, (p) => Math.round(p).toString());

  // The track still thickens on hover under reduced motion; it just arrives
  // instead of travelling. The thickening is the affordance — losing it would
  // cost the control its hover state, not just its animation.
  const grow = () =>
    reduceMotion ? scale.set(HOVER_SCALE) : animate(scale, HOVER_SCALE, SPRING.snappy);
  const shrink = () => (reduceMotion ? scale.set(1) : animate(scale, 1, SPRING.snappy));

  return (
    <div className={cn("relative flex w-full flex-col items-stretch", className)}>
      {showValue && (
        <motion.p
          aria-hidden
          style={{ opacity: readout }}
          className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 text-[11px] font-medium tabular-nums tracking-[0.05em]"
        >
          {valueText}
        </motion.p>
      )}

      <motion.div
        onHoverStart={grow}
        onHoverEnd={shrink}
        onTouchStart={grow}
        onTouchEnd={shrink}
        style={{ scale, opacity: wrapperOpacity }}
        className="flex w-full touch-none select-none items-center justify-center gap-3"
      >
        <motion.div
          style={{ x: leftIconX, scale: leftIconScale }}
          className="shrink-0 origin-right"
        >
          {leftIcon}
        </motion.div>

        <div
          ref={sliderRef}
          role="slider"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-valuemin={startingValue}
          aria-valuemax={maxValue}
          aria-valuenow={Math.round(defaultValue)}
          aria-valuetext={formatValue?.(defaultValue)}
          onKeyDown={handleKeyDown}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          className={cn(
            "group relative flex flex-grow cursor-grab touch-none select-none",
            "items-center py-3 outline-none active:cursor-grabbing",
          )}
        >
          {/*
            The focus ring is its own element rather than an outline on the box
            above, because that box carries three rems of vertical padding to
            give the track a thumb-sized hit area — ringing it would draw a pill
            twice the height of anything visible. This hugs the track instead.
          */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-1/2 h-4 -translate-y-1/2",
              "rounded-full ring-2 ring-current/40 opacity-0 group-focus-visible:opacity-100",
            )}
          />
          <motion.div
            style={{
              scaleX: trackScaleX,
              scaleY: trackScaleY,
              transformOrigin: trackOrigin,
              height: trackHeight,
              marginTop: trackMargin,
              marginBottom: trackMargin,
            }}
            className="relative flex flex-grow overflow-hidden rounded-full"
          >
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-current opacity-25"
            />
            <motion.span
              aria-hidden
              className="absolute inset-0 origin-left rounded-full bg-current"
              style={{ scaleX: fillScaleX }}
            />
          </motion.div>
        </div>

        <motion.div
          style={{ x: rightIconX, scale: rightIconScale }}
          className="shrink-0 origin-left"
        >
          {rightIcon}
        </motion.div>
      </motion.div>
    </div>
  );
}
