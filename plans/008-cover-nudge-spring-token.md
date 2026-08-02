# Plan 008 — Put the Now Playing cover nudge on `SPRING.snappy`

**Repo commit this plan was written against:** `fcc289b`
**Severity:** HIGH (Purpose & frequency — sluggish response on the most-pressed control)
**File:** `components/player/now-playing.tsx`

## Problem

`lib/motion/config.ts` documents what each spring is for:

```ts
/** Presses, toggles, icon swaps. Settles in ~120ms. */
snappy: { type: "spring", stiffness: 620, damping: 34, mass: 0.6 },

/** Sheets, dialogs, Now Playing. Long travel, so more mass and more damping. */
sheet: { type: "spring", stiffness: 280, damping: 32, mass: 0.9 },
```

`sheet` is explicitly justified by **long travel**. The Now Playing cover uses it
for a 6% scale nudge. Current code, `components/player/now-playing.tsx` lines
305-312:

```tsx
<motion.div
  animate={{ scale: isPlaying ? 1 : 0.94 }}
  transition={SPRING.sheet}
  className={
    panelOpen
      ? "w-[min(30vw,min(38vh,360px))]"
      : "w-[min(78vw,min(52vh,460px))]"
  }
>
```

The effect itself is right and should be kept — the comment above it correctly
notes that Apple Music does this and that it is the clearest available signal of
playback state for one composited transform. The problem is only the spring.

`SPRING.sheet` carries mass 0.9 and stiffness 280 precisely so that a full-screen
sheet travelling hundreds of pixels does not feel weightless. Applied to a 6%
scale change it produces a slow, floaty settle on a control the listener presses
constantly. The tap has finished long before the artwork stops moving, which is
the definition of an animation reading as latency.

`isPlaying` is a toggle, so `SPRING.snappy` — "presses, toggles, icon swaps",
~120ms — is the documented match.

## Fix

In `components/player/now-playing.tsx`, change line 307 from:

```tsx
              transition={SPRING.sheet}
```

to:

```tsx
              transition={SPRING.snappy}
```

`SPRING` is already imported at line 14 (`import { SPRING, TWEEN } from "@/lib/motion/config";`), so no import change is needed.

Add a brief note to the existing comment block above the element (currently
beginning "The cover eases down a couple of percent when paused, the way Apple
Music does.") so the choice does not get "corrected" back later:

```
             * `snappy` rather than `sheet`: this is a toggle, not travel. The
             * sheet spring's mass is there for a full-screen slide, and on a 6%
             * nudge it reads as the artwork lagging behind the button.
```

## Scope boundaries

- Change **only** the `transition` prop on this one element.
- Do **not** change the `scale: 0.94` value — the amount of the nudge is
  deliberate and was not part of this finding.
- Do **not** change any other use of `SPRING.sheet` in this file. The sheet
  variant itself (`variants={sheet}` on the root `motion.div`, line ~185) is a
  genuine full-screen slide and is correct.
- Do not touch `components/player/player-bar.tsx`'s use of `SPRING.sheet`, which
  is also real travel.

## Verification

1. `npx tsc --noEmit` passes.
2. `npx vitest run` — 596 tests pass.
3. **Feel-check (the whole point of this change, and it cannot be read off the
   code):** open Now Playing on a playing episode. Press pause, then play, then
   pause again in quick succession. The artwork should settle at roughly the
   same moment the play/pause button's own press animation does — that button
   uses `pressPrimary`, which is `SPRING.snappy`. Before this change the artwork
   visibly trails it.
4. **Interruption check:** tap play/pause rapidly (5-6 times in ~2 seconds). The
   scale should track each toggle and carry velocity between them without
   stalling or queueing. Springs handle this natively; this is a check that
   nothing else regressed.
5. Confirm the sheet itself still slides up and down normally when opening and
   closing Now Playing — that is a different animation and must be unaffected.
