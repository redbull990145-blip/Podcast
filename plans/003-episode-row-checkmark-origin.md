# Plan 003 — Fix the "Played" checkmark's grow-from-nothing entrance

**Repo commit this plan was written against:** `f7144a0`
**Severity:** HIGH (Physicality)
**File:** `components/episodes/episode-row.tsx`

## Problem

`lib/motion/variants.ts`'s own `popover` variant documents the app's rule for anything appearing on screen (current lines 31-38 comment):

> "The scale starts at 0.96 rather than 0... Growing from nothing is a stock 'web animation' tell; native menus expand a few percent from the control that opened them, which reads as the control unfolding rather than a new object appearing."

`components/episodes/episode-row.tsx` violates this directly. The "Played" checkmark badge, which appears next to an episode's title once it's marked played, animates in from literal zero (current lines 121-135):

```tsx
<AnimatePresence>
  {progress?.played && (
    <motion.span
      title="Played"
      className="mt-0.5 text-success"
      aria-label="Played"
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={SPRING.pop}
    >
      <CheckCircle2 className="size-4" />
    </motion.span>
  )}
</AnimatePresence>
```

`episode-row.tsx` renders inside every episode list in the app (library, discover results, queue, podcast detail pages), so this "pop from nothing" plays constantly as users mark episodes played or scrub past the played threshold.

This component is imported into `components/episodes/episode-row.tsx` alongside `SPRING` from `lib/motion/config.ts` already — no new imports are needed for this fix.

## Fix

Change `initial` and `exit` to start/end at `scale: 0.5` rather than `scale: 0`, keeping everything else identical. (0.5 rather than `popover`'s 0.96 is deliberate here — the checkmark is a much smaller, transient status glyph appearing in a tight inline row, closer in kind to an icon-badge "arrival" than a menu unfolding; going all the way to 0.96 would make the pop nearly invisible at this size given the spring is already fast. 0.5 keeps a perceptible-but-not-jarring arrival, still clearly not "grown from nothing.")

```tsx
<AnimatePresence>
  {progress?.played && (
    <motion.span
      title="Played"
      className="mt-0.5 text-success"
      aria-label="Played"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.5, opacity: 0 }}
      transition={SPRING.pop}
    >
      <CheckCircle2 className="size-4" />
    </motion.span>
  )}
</AnimatePresence>
```

Only the two `scale: 0` occurrences (in `initial` and `exit`) change, to `scale: 0.5`. `animate={{ scale: 1, opacity: 1 }}` and `transition={SPRING.pop}` are already correct and unchanged — `SPRING.pop` is the right engine here per its own doc comment ("Popovers, menus, badges — small elements arriving on screen").

Note: this is currently coupled with an opacity animation under the same spring `transition`, which is the same class of issue addressed in Plan 002 (spring-on-opacity) — but that plan only touches `lib/motion/variants.ts`'s shared variants, not this component's inline `motion.span`, since this badge doesn't use the `popover` variant (it's a bespoke inline animation). If Plan 002 is also being executed, consider optionally splitting this badge's opacity onto `TWEEN.fast` too for full consistency — but that is out of scope for this plan; this plan fixes only the grow-from-nothing origin bug. Do not make that additional change here.

## Scope boundaries

- Only the `initial`/`exit` scale values in the "Played" badge block of `episode-row.tsx`. Do not touch `animate`, `transition`, the `CheckCircle2` icon, the surrounding `<span className="flex shrink-0 items-center gap-1">` layout, or the neighboring `QueueButton`/`DownloadButton` components.
- Do not touch any other `scale: 0` usage elsewhere in the codebase as part of this plan — this plan is scoped to this one badge. (If other grow-from-nothing entrances are found elsewhere, they should be their own finding/plan.)

## Verification

1. `npm run typecheck` should pass — this is a numeric literal change only.
2. Visually: in the library or an episode list, mark an unplayed episode as played (or scrub playback past the "played" threshold, whatever triggers `progress?.played` in this app's playback logic — check `lib/player/store.ts` or wherever `progress.played` is computed if you need to force the state for testing) and watch the checkmark arrive. It should visibly grow in from roughly half-size rather than snapping in from a dot/nothing. Then reverse the state (mark unplayed, if that's possible in the UI, or navigate away and back to a different played episode) to confirm the exit also shrinks toward 0.5 rather than to a point.
3. Feel-check in slow motion (record a short screen capture and step frame-by-frame, or use browser devtools' Animations panel): confirm the icon's silhouette is recognizable as "the same checkmark, smaller" through the animation rather than a shapeless blob — `CheckCircle2` at `size-4` (16px) starting from 0.5 scale (8px) should stay legible, which is part of why 0.5 rather than a smaller starting scale was chosen.
4. Spot-check the same component rendering inside a densely-packed list (e.g. library view with many episodes) to confirm the change reads fine at a glance among several rows, not just in isolation.
