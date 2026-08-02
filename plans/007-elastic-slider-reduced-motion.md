# Plan 007 — Gate `ElasticSlider` on reduced motion, and put its spring on a token

**Repo commit this plan was written against:** `fcc289b`
**Severity:** HIGH (Accessibility) + MEDIUM (Easing tokens)
**File:** `components/ui/elastic-slider.tsx`

Two independent fixes in one plan because they touch the same file within a few
lines of each other; splitting them would guarantee a merge conflict.

---

## Problem A (HIGH) — no reduced-motion coverage at all

The app has three layers of reduced-motion handling, and this component sits
outside all of them:

1. `components/providers/motion-provider.tsx` wraps the app in
   `<MotionConfig reducedMotion="user">`. **This only affects animation *props*
   on `motion.*` components** (`animate`, `whileHover`, `whileTap`, `variants`).
   It does not intercept a `MotionValue` that application code drives itself.
2. `app/globals.css`'s `@media (prefers-reduced-motion: reduce)` block collapses
   plain **CSS** transitions and keyframes. This component animates through
   JavaScript, not CSS, so that block never applies to it.
3. Components doing their own imperative animation call `useReducedMotion()`
   directly. `captions-panel.tsx` does this (line 223, gating the transcript
   travel, the karaoke fill and the blur/scale emphasis) and
   `animated-artwork.tsx` does this (line 81, feeding `enabled` and
   `motionDisabled`).

`elastic-slider.tsx` is the only animated subsystem in the codebase that does
none of the three. It drives every visual through `useMotionValue` +
`useTransform` and six imperative `animate()` calls:

```
line 192  animate(readout, 1, TWEEN.fast);            // readout fades in on grab
line 199  animate(readout, 0, TWEEN.normal);          // …and out on release
line 200  animate(overflow, 0, { type: "spring", … }) // elastic snap-back
line 253  animate(readout, 0, TWEEN.normal);          // keyboard readout fade
line 314  animate(scale, HOVER_SCALE, SPRING.snappy)  // hover grow
line 315  animate(scale, 1, SPRING.snappy)            // hover shrink
```

A user with "reduce motion" set therefore still gets the full hover grow, the
full rubber-band overflow stretch on both icons and the track, and the spring
snap-back. On the volume control, which is a hot surface.

## Fix A

Import the hook and derive a single flag, then gate the three *motion* effects.
Keep opacity — Motion's own `reducedMotion="user"` semantics deliberately leave
fades intact, and the value readout is information, not decoration.

1. Add to the existing `motion/react` import at the top of the file:

```ts
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "motion/react";
```

2. Inside the component, alongside the other hooks (near `const sliderRef = …`):

```ts
/*
 * `MotionConfig reducedMotion="user"` does not reach this component: it gates
 * animation props on `motion.*` elements, and everything here is driven through
 * motion values that application code sets directly. So the preference has to
 * be read and applied by hand, the same way captions-panel and animated-artwork
 * do it.
 *
 * Opacity is deliberately left alone. Motion's own reduced-motion behaviour
 * keeps fades, and the value readout is information — hiding it would remove
 * feedback rather than remove motion.
 */
const reduceMotion = useReducedMotion() ?? false;
```

3. **Hover grow** — replace lines 314-315:

```ts
const grow = () => animate(scale, HOVER_SCALE, SPRING.snappy);
const shrink = () => animate(scale, 1, SPRING.snappy);
```

with:

```ts
// The track still thickens on hover; it just arrives without the travel.
const grow = () =>
  reduceMotion ? scale.set(HOVER_SCALE) : animate(scale, HOVER_SCALE, SPRING.snappy);
const shrink = () => (reduceMotion ? scale.set(1) : animate(scale, 1, SPRING.snappy));
```

4. **Elastic overflow** — in the `useMotionValueEvent(clientX, "change", …)`
handler, the line currently reading:

```ts
    overflow.jump(decay(past, MAX_OVERFLOW));
```

becomes:

```ts
    // The rubber-band stretch is pure decoration — it conveys nothing the value
    // does not already say — so it is the first thing to go.
    overflow.jump(reduceMotion ? 0 : decay(past, MAX_OVERFLOW));
```

5. **Snap-back** — in `handlePointerUp`, the `animate(overflow, …)` call (see
Fix B below for its final form) should be skipped entirely when
`reduceMotion` is true, since `overflow` is already pinned at 0:

```ts
const handlePointerUp = () => {
  draggingRef.current = false;
  animate(readout, 0, TWEEN.normal);
  if (reduceMotion) {
    overflowDirection.set(0);
    return;
  }
  animate(overflow, 0, SPRING.pop).then(() => {
    overflowDirection.set(0);
  });
};
```

---

## Problem B (MEDIUM) — the snap-back spring is ungoverned

Line 200 currently:

```ts
animate(overflow, 0, { type: "spring", bounce: 0.5, duration: 0.6 }).then(() => {
```

This is an inline spring config that exists nowhere else in the codebase. It
came in unchanged from the React Bits reference implementation. Two problems:

- `lib/motion/config.ts` is documented as the single source of motion timing;
  every other spring in the app is a `SPRING.*` token.
- `duration: 0.6` is longer than every token the app defines (the slowest,
  `TWEEN.slow`, is 380ms), and `bounce: 0.5` is a visible overshoot in a
  codebase whose spring header comment explicitly says "enough give to feel
  physical, not enough to visibly bounce. Overshoot is the difference between
  'alive' and 'toy-like'."

## Fix B

Use `SPRING.pop` (stiffness 420, damping 32, mass 0.7) — the token for "small
elements arriving on screen", which is the closest documented match for a
control springing back to rest.

Replace the inline config with `SPRING.pop`, as shown in the final
`handlePointerUp` in Fix A step 5 above.

`SPRING` is already imported in this file — confirm the import line reads
`import { SPRING, TWEEN } from "@/lib/motion/config";` and add `SPRING` if it is
missing.

**This is the one change in this plan that alters how the slider feels at rest
settings**, so it needs a real feel-check (below). If `SPRING.pop` reads as too
tight for the rubber-band release, that is a legitimate finding — report it
rather than reintroducing a magic number, and the fix is to add a named token to
`config.ts` with a rationale comment.

## Scope boundaries

- Touch **only** `components/ui/elastic-slider.tsx`.
- Do **not** change `TWEEN.fast` / `TWEEN.normal` on the readout fades (lines
  192, 199, 253) — those are already on tokens and are opacity, which stays.
- Do **not** change `SPRING.snappy` as the hover spring; only gate it.
- Do **not** touch `components/ui/slider.tsx` (plan 006) or
  `components/player/volume-control.tsx`.
- Do not add a `prefers-reduced-motion` CSS rule for this component — the
  problem is specifically that its motion is JS-driven, so CSS cannot reach it.

## Verification

1. `npx tsc --noEmit` passes.
2. `npx vitest run` — 596 tests pass.
3. **Reduced-motion check.** In Chrome DevTools: Rendering panel →
   "Emulate CSS media feature prefers-reduced-motion" → `reduce`. Then, with
   the volume popover open:
   - Hover the slider: the track should still thicken (6px → 10px) but arrive
     immediately, with no spring travel.
   - Drag hard past the left and right ends: the track must **not** stretch and
     the icons must **not** slide outward at all.
   - Release: nothing should spring back, because nothing moved.
   - The numeric readout should still fade in and out — that is intended.
4. **Normal-motion regression check.** Turn the emulation off and repeat: the
   elastic stretch, the icon push and the snap-back must all still work. This is
   the check that catches a gate applied too broadly.
5. **Feel-check for Fix B (needs eyes, cannot be judged from code):** drag well
   past one end and release, several times. `SPRING.pop` should settle faster
   than the old 600ms and without a pronounced bounce. Compare against the
   volume popover's own open/close animation, which also uses `SPRING.pop` —
   they should read as the same material.
