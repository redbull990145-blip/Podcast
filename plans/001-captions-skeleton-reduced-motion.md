# Plan 001 — Replace the captions-loading skeleton with the app's own skeleton pattern

**Repo commit this plan was written against:** `f7144a0`
**Severity:** HIGH (Accessibility + Cohesion)
**File:** `components/player/captions-panel.tsx`

## Problem

While a transcript is loading, `captions-panel.tsx` renders eight `motion.div` elements that pulse their own `opacity` in an infinite loop:

```tsx
// components/player/captions-panel.tsx, current lines ~142-161
if (isPending) {
  return (
    <div className="flex-1 space-y-3 pt-2">
      {Array.from({ length: 8 }, (_, i) => (
        <motion.div
          key={i}
          animate={{ opacity: [0.35, 0.7, 0.35] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.06,
          }}
          className="h-4 rounded bg-white/10"
          style={{ width: `${88 - (i % 4) * 14}%` }}
        />
      ))}
    </div>
  );
}
```

This is broken two ways:

1. **Accessibility.** This app has exactly two reduced-motion mechanisms, and this loop falls through both. `components/providers/motion-provider.tsx` sets `<MotionConfig reducedMotion="user">`, which per its own doc comment "strips transform and layout animation while leaving opacity intact" — it does **not** touch this. And the CSS rule in `app/globals.css` (`@media (prefers-reduced-motion: reduce)`, around line 410) only overrides `animation-duration`/`transition-duration` on plain CSS animations/transitions — it has no effect on a value driven by Motion's JS `animate` prop. Net result: a user with reduced motion turned on gets an infinite, un-stoppable opacity pulse for as long as the transcript is loading.
2. **Cohesion.** The app already has a purpose-built, documented loading-skeleton pattern that solves this correctly. `app/globals.css` (around lines 185-216) defines a `.skeleton` class with this reasoning in its own comment: *"A sheen travelling across the block rather than the whole block pulsing. Pulsing opacity says 'something is here and it is blinking'; a sweep says 'something is on its way', which is the actual message. It is one background-position animation, and it stays in CSS rather than moving to Motion because a skeleton must render before any JavaScript has run."* That `.skeleton` class is wrapped by a `Skeleton` component in `components/ui/page.tsx`:

```tsx
// components/ui/page.tsx, current lines 47-54
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-lg bg-surface-raised", className)}
    />
  );
}
```

The `.skeleton::after` sweep is a plain CSS `@keyframes` animation, so it's already correctly covered by the `@media (prefers-reduced-motion: reduce)` block, which sets `animation-iteration-count: 1 !important` on it — the loop genuinely stops (not just speeds up to 0.01ms and keeps looping).

## Fix

Replace the bespoke `motion.div` loop with the existing `Skeleton` primitive, shaped to look like transcript lines (the same way `EpisodeListSkeleton` in the same file shapes it to look like episode rows — use that as your exemplar for "how to compose `Skeleton` into a shape").

### Step 1 — Add the import

In `components/player/captions-panel.tsx`, add to the existing local-component imports (it currently imports `TranscribeProgress` from `./transcribe-progress` around line 45):

```tsx
import { Skeleton } from "@/components/ui/page";
```

(Adjust the import path if this repo's `tsconfig.json` path alias differs from `@/components/...` — check the alias used by the `TranscribeProgress` import one line above and match its style; if imports in this file use relative paths instead of `@/`, use `../ui/page` instead.)

### Step 2 — Replace the block

Replace the `isPending` block (current lines ~142-161) with:

```tsx
if (isPending) {
  return (
    <div className="flex-1 space-y-3 pt-2">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${88 - (i % 4) * 14}%` }} />
      ))}
    </div>
  );
}
```

Note `Skeleton` as defined only accepts `className`, not `style` — extend it minimally rather than fighting it:

```tsx
// components/ui/page.tsx — extend Skeleton to accept an optional style passthrough
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-lg bg-surface-raised", className)}
      style={style}
    />
  );
}
```

This is a backward-compatible, additive change — every other call site (`EpisodeListSkeleton` and any others) omits `style` and is unaffected.

### Step 3 — Remove now-dead imports

After the edit, `motion` may no longer be needed for this specific block, but it's used elsewhere in the same file (e.g. the transcript's per-line motion, `AnimatePresence` for the regenerate-error banner) — do **not** remove the `motion`/`AnimatePresence` import from the top of the file. Only remove imports that become fully unused; run a search for other `motion.` usages in the file before touching the import block (there are several — this file is large).

## Scope boundaries

- Touch only the `isPending` block in `captions-panel.tsx` and the `Skeleton` component in `components/ui/page.tsx`.
- Do not touch the `TranscribeProgress` component, the `NoCaptions` branch, or any of the transcript's per-line rendering/emphasis logic later in the same file — those are unrelated and already correct.
- Do not change the `.skeleton` CSS class or `@keyframes skeleton-sweep` in `app/globals.css`.

## Verification

1. `npm run typecheck` should pass (no new TS errors from the `Skeleton` prop addition or the import).
2. Visually: open a podcast episode whose transcript hasn't been generated/cached yet (or throttle the network in devtools) and confirm the loading state now shows the same shimmer-sweep look used by `EpisodeListSkeleton` elsewhere in the app (library loading state), not a pulsing-opacity block stack.
3. Reduced-motion check: enable "Reduce motion" in OS accessibility settings (macOS: System Settings → Accessibility → Display → Reduce Motion; Windows: Settings → Accessibility → Visual effects → Animation effects off), reload the transcript-loading state, and confirm the sweep animation plays once and then holds static — it must not loop indefinitely. This is the actual bug being fixed; don't skip this check.
4. Frame-by-frame / slow-motion isn't necessary here since the fix removes JS-driven animation entirely in favor of an existing, already-shipped CSS pattern — the risk is purely "does the reduced-motion rule actually apply now," which step 3 covers directly.
