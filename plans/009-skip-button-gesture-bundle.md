# Plan 009 — Scale the skip buttons by their size, via the shared gesture bundles

**Repo commit this plan was written against:** `fcc289b`
**Severity:** MEDIUM (Cohesion — contradicts the documented rule in `gestures.ts`)
**File:** `components/player/skip-button.tsx`

## Problem

`lib/motion/gestures.ts` states the rule in its header:

> "The scale is inversely proportional to the target's size. A 32px icon button
> needs to move ~8% for the press to register at all; a full-width primary
> button only needs ~2%, and more would look like it was collapsing."

and provides the bundles:

```ts
/** Icon buttons and other small square targets. */
export const press = {
  whileHover: { scale: 1.06 },
  whileTap: { scale: 0.92 },
  transition: SPRING.snappy,
} as const;

/** Text buttons, pills, list rows — anything wider than it is tall. */
export const pressSubtle = {
  whileHover: { scale: 1.015 },
  whileTap: { scale: 0.975 },
  transition: SPRING.snappy,
} as const;
```

`SkipButton` renders at two sizes and applies one hardcoded gesture to both.
Current code, `components/player/skip-button.tsx` lines 37-55:

```tsx
  const large = size === "lg";

  return (
    <motion.button
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      transition={SPRING.snappy}
      …
      className={cn(
        "relative grid place-items-center rounded-full transition-colors",
        large
          ? "size-12 text-white/85 hover:bg-white/15 hover:text-white"
          : "size-9 text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
```

So the 48px Now Playing button and the 36px docked-bar button both move
1.08 / 0.9 — and that is *more* travel than `press` (1.06 / 0.92) gives the
small icon buttons beside them. The rule is inverted twice over: the large
variant should move less than the small one, and instead both move more than the
shared bundle for small targets.

Skip forward/back is a hot control, and in Now Playing the skip buttons sit
directly either side of the play button, so the mismatch is visible in a direct
comparison.

## Fix

Select the bundle by size and spread it.

1. Add the import. The file currently imports `SPRING` from `@/lib/motion/config`
   — check whether it still needs it after this change (it will not, unless
   `SPRING` is used elsewhere in the file; the rotation animation on the inner
   `motion.span` may use it, so verify before removing). Add:

```ts
import { press, pressSubtle } from "@/lib/motion/gestures";
```

2. Replace the three gesture props (lines 41-43):

```tsx
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.9 }}
      transition={SPRING.snappy}
```

with a spread chosen by size:

```tsx
      {...(large ? pressSubtle : press)}
```

`large` is already computed on line 37. Both bundles carry
`transition: SPRING.snappy`, so the transition prop is covered by the spread and
must not also be passed separately — a duplicate `transition` after the spread
would override it identically, but is noise.

3. Add a short comment above the spread so the pairing is not undone later:

```tsx
      {/*
        Bundle by size, per the rule in gestures.ts: the 48px Now Playing button
        needs less travel than the 36px docked one to read as the same press.
      */}
```

Note this is JSX inside the element's prop list, so it must be written as a
`{/* */}` comment on its own line above the spread, or as a `//` comment if
placed inside a multi-line prop expression. Prefer placing a `/* */` comment
above the `<motion.button` opening tag instead if the linter objects.

**If `SPRING` becomes unused** in this file after the edit, remove it from the
import to keep the build warning-free. If the inner rotation `motion.span` (line
~57-59, `animate={{ rotate: turns * TURN }}`) still references it, leave the
import in place.

## Scope boundaries

- Touch **only** `components/player/skip-button.tsx`.
- Do **not** change the rotation animation on the inner `motion.span` — the
  `turns * TURN` spin is a separate, working effect.
- Do **not** change the `size-12` / `size-9` classes or any colour classes.
- Do **not** edit `lib/motion/gestures.ts`. The bundles are correct; this is
  about using them.
- Do not apply the same treatment to other buttons in this pass — other one-off
  gesture values exist (`captions-panel.tsx` lines 490 and 918-920) and are
  deliberately left for a separate change.

## Verification

1. `npx tsc --noEmit` passes.
2. `npx vitest run` — 596 tests pass.
3. **Side-by-side feel-check (this is the finding, so it needs eyes):** open Now
   Playing. Press the skip-back button, then the play button, then skip-forward.
   All three should feel like the same material — the play button uses
   `pressPrimary` (tap-only, 0.9) and the skips now use `pressSubtle` (0.975).
   The large skips should no longer visibly out-travel the play button.
4. Then compare against the docked player bar's skip buttons, which now use
   `press` (1.06 / 0.92). The small ones should move *more*, not less. If the
   large ones still look punchier, the ternary is the wrong way round.
5. Confirm hovering still produces a visible grow on both sizes —
   `pressSubtle`'s 1.015 is intentionally slight, but it must not be zero.
