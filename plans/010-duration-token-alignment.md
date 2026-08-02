# Plan 010 — Align stray CSS durations onto the token scale

**Repo commit this plan was written against:** `fcc289b`
**Severity:** MEDIUM (Cohesion & tokens — widest blast radius is the shared `Button`)
**Files:** 9 call sites across `components/` (listed below)

## Problem

`app/globals.css` defines the duration scale:

```css
  --duration-fast: 140ms;
  --duration-normal: 220ms;
  --duration-slow: 380ms;
```

mirrored in `lib/motion/config.ts` as `DURATION.fast / normal / slow` (0.14 /
0.22 / 0.38). The scale exists so that "the remaining CSS transitions and these
JS animations stay indistinguishable" (config.ts header).

Nine places use a Tailwind default duration instead. None is individually
dramatic — the point is that together they mean the app has two duration scales,
and the default Tailwind one wins in the places a listener touches most.

| # | File:line | Current | Nearest token | Notes |
|---|---|---|---|---|
| 1 | `components/ui/button.tsx:57` | `duration-150` | `--duration-fast` (140ms) | **Shared Button — widest reach of any item here** |
| 2 | `components/power-mode/power-mode-toggle.tsx:42` | `duration-200` | `--duration-normal` (220ms) | |
| 3 | `components/settings/artwork-motion-control.tsx:62` | `duration-200` | `--duration-normal` | |
| 4 | `components/settings/audio-enhancements-panel.tsx:161` | `duration-200` | `--duration-normal` | |
| 5 | `components/settings/audio-enhancements-panel.tsx:189` | `duration-200` | `--duration-normal` | |
| 6 | `components/settings/audio-enhancements-panel.tsx:197` | `duration-200` | `--duration-normal` | knob travel, keeps `--ease-spring` |
| 7 | `app/page.tsx:138` | `duration-200` | `--duration-normal` | landing page |
| 8 | `components/player/captions-panel.tsx:545` | `duration-300` | `--duration-normal` | |
| 9 | `components/artwork/animated-artwork.tsx:168` | `duration-500` | `--duration-slow` (380ms) | canvas fade-in |

Plus one JS-side near-miss:

| 10 | `components/player/player-bar.tsx:149` | `duration: 0.24` | `DURATION.normal` (0.22) | see the caution below |

## Fix

For items 1-9, replace the Tailwind duration utility with the token, keeping
every other class on the line untouched. The arbitrary-value syntax is:

```
duration-150  →  duration-[var(--duration-fast)]
duration-200  →  duration-[var(--duration-normal)]
duration-300  →  duration-[var(--duration-normal)]
duration-500  →  duration-[var(--duration-slow)]
```

Worked example — `components/ui/button.tsx` line 57:

```tsx
        "transition-colors duration-150",
```

becomes:

```tsx
        "transition-colors duration-[var(--duration-fast)]",
```

Note items 8 and 9 are deliberate *downward* moves (300→220, 500→380). Both are
fades where the token is the app's considered answer; if either reads as too
quick after the change, say so rather than reverting to a magic number.

For item 10, `components/player/player-bar.tsx` line 149:

```tsx
          exit={{ y: "110%", transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } }}
```

becomes:

```tsx
          exit={{ y: "110%", transition: { duration: DURATION.normal, ease: [0.4, 0, 1, 1] } }}
```

adding `DURATION` to the existing `@/lib/motion/config` import.

**Caution on item 10.** The comment directly above that line documents a
deliberate decision:

> "Arriving gets the spring; leaving gets a tween. A spring's tail is asymptotic,
> so the same curve run backwards measured 600ms before the element could
> unmount — long after it had visually gone. When someone closes the player they
> want it gone, not eased away."

That reasoning is about **tween-instead-of-spring** and about the **`[0.4, 0, 1, 1]`
ease-in curve**, both of which are correct and must be preserved exactly. Only
the `0.24` literal changes, and only because it is a 20ms near-miss on a scale
that exists. Do not touch the easing array. Do not convert this back to a spring.

## Scope boundaries

- Change **only** the duration value at each of the ten listed sites.
- Do **not** change any `ease-*` class or easing array anywhere in this plan.
  Several of these lines carry `ease-[var(--ease-out)]` or
  `ease-[var(--ease-spring)]` already and those are correct.
- Do **not** change `transition-colors` / `transition-transform` /
  `transition-opacity` property lists into `transition-all`.
- Do **not** touch `components/settings/opml-panel.tsx:154`'s `duration-300` —
  that line also animates `width` and is handled by plan 011, which changes the
  property and the duration together.
- Do **not** touch `components/ui/slider.tsx:187`'s `duration-150` — plan 006
  changes that line.
- Do not go hunting for further durations beyond this list. If you find one,
  note it; do not fix it in this pass.

## Verification

1. `npx tsc --noEmit` passes.
2. `npx vitest run` — 596 tests pass.
3. **Confirm Tailwind actually emits the arbitrary values.** This is the main
   risk in this plan: a typo inside `duration-[…]` fails silently, leaving the
   element with *no* transition duration rather than a wrong one. For at least
   `button.tsx`, inspect the element in DevTools and confirm computed
   `transition-duration` is `0.14s`, not `0s`.
4. **Feel-check the Button (item 1), since it is everywhere:** hover a primary
   button and a secondary button. The colour change should be marginally quicker
   than before and should now match the hover recolour on adjacent surfaces such
   as list rows.
5. **Feel-check item 9:** load an episode with artwork in Now Playing and watch
   the canvas fade in over the static image. At 380ms it should still read as a
   soft handover, not a cut. If it now snaps, report it.
6. Spot-check one settings toggle (item 6) and confirm the knob still travels
   with a slight overshoot — `--ease-spring` must survive the edit.
