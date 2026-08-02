# Plan 006 — Stop the seek-bar thumb growing from `scale: 0`

**Repo commit this plan was written against:** `fcc289b`
**Severity:** HIGH (Physicality — the app's own documented anti-pattern, on a hot surface)
**File:** `components/ui/slider.tsx`

## Problem

`lib/motion/variants.ts` states the rule in the `popover` variant's header comment:

> "The scale starts at 0.96 rather than 0 … Growing from nothing is a stock "web animation" tell; native menus expand a few percent from the control that opened them, which reads as the control unfolding rather than a new object appearing."

Plan 003 already applied exactly this correction once, to the "played" checkmark in `episode-row.tsx`, using `scale: 0.5` as the floor.

The shared `Slider`'s thumb still does the thing plan 003 removed. Current code, `components/ui/slider.tsx` lines 183-191:

```tsx
<span
  className={cn(
    "-ml-1.5 block size-3 rounded-full shadow-[var(--shadow-soft)]",
    colours.fill,
    "scale-0 transition-transform duration-150 ease-[var(--ease-spring)]",
    "group-hover/slider:scale-100 group-focus-within/slider:scale-100",
    isDragging && "scale-100",
  )}
/>
```

Two things compound here:

1. `scale-0` means the thumb materialises out of nothing at a point on the track.
2. `--ease-spring` is `cubic-bezier(0.34, 1.56, 0.64, 1)` — it deliberately overshoots. Overshooting *from zero* is the most conspicuous possible version of this: the dot springs past full size on arrival.

This matters more than the checkmark did, because `Slider` is the seek bar. It is rendered by `Scrubber` in both `player-bar.tsx` (docked, visible for the whole session) and `now-playing.tsx`. Hovering the scrubber is something a listener does constantly.

## Fix

Change the resting scale from `0` to `50`, matching what plan 003 used.

In `components/ui/slider.tsx`, replace line 187:

```tsx
    "scale-0 transition-transform duration-150 ease-[var(--ease-spring)]",
```

with:

```tsx
    "scale-50 transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)]",
```

Two changes on that line:

- `scale-0` → `scale-50`. The thumb now grows from half size, so it reads as the existing dot swelling under the pointer rather than an object appearing.
- `duration-150` → `duration-[var(--duration-fast)]` (140ms). `duration-150` is a 10ms near-miss on the token scale; while this line is being edited it should stop being one. Do not change the easing — `--ease-spring` is correct now that it is no longer overshooting from zero.

Leave lines 188-189 exactly as they are. `scale-100` remains the hover/focus/drag target.

## Scope boundaries

- Touch **only** line 187 of `components/ui/slider.tsx`.
- Do **not** alter `glide` (line 132, `transform 260ms linear`). That is a deliberate, documented interpolation of a constant-rate playback clock between ~4Hz position ticks, and linear is correct for it. It has been reviewed and is not in scope.
- Do **not** change `ElasticSlider` (`components/ui/elastic-slider.tsx`) — that is a separate component with no thumb, covered by plan 007.
- Do not touch the `ticks`, fill, or `<input>` elements.

## Verification

1. `npx tsc --noEmit` passes.
2. `npx vitest run` — 596 tests should still pass. No test asserts on this class string, so none should change.
3. **Feel-check, and this one genuinely needs eyes:** start playback so the docked player bar is showing. Move the pointer onto the seek bar and off it, repeatedly. The thumb should swell from a visible half-size dot, not blink into existence. Then do the same in Now Playing (the light-tone variant).
4. **Slow-motion check:** in DevTools, set the animation inspector to 25% speed (or temporarily raise the duration to `1s`) and hover. Confirm the dot is visible at rest-size *before* the growth begins. If it still appears from nothing, the class did not take effect — check Tailwind is emitting `scale-50` and that no later class in the `cn()` chain is overriding it.
5. Confirm the thumb still reaches full size while dragging even if the pointer leaves the track (the `isDragging && "scale-100"` branch).
