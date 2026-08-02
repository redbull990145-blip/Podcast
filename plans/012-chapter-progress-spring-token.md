# Plan 012 — Give the chapter progress bar its own spring token

**Repo commit this plan was written against:** `fcc289b`
**Severity:** LOW (Cohesion — coupling, not feel)
**Files:** `lib/motion/config.ts`, `components/player/chapter-strip.tsx`

## Problem

`SPRING.transcript` is documented in `lib/motion/config.ts` as a value measured
for one specific purpose:

> "The transcript's travel between lines. Measured off Spotify's lyrics view
> frame by frame rather than guessed at. Tracking one line across three
> transitions in a 60fps capture gives a natural frequency of about 12.6 rad/s
> and a damping ratio just under one … That last detail is the whole character
> of it … it stays a hair, because the eye is mid-sentence on these words."

The chapter strip borrows it for a progress bar. Current code,
`components/player/chapter-strip.tsx` lines 135-142:

```tsx
      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full origin-left rounded-full bg-white/40"
          initial={false}
          animate={{ scaleX: progress }}
          transition={SPRING.transcript}
          style={{ transformOrigin: "left" }}
        />
      </div>
```

**This currently looks fine and must keep looking fine.** The bar is driven by
playback position, which the store republishes roughly four times a second, and
`SPRING.transcript` is a slow, gently-damped spring (stiffness 150, damping 20,
mass 0.9) that smooths those discrete steps into continuous travel. That is
genuinely the right *behaviour*.

The problem is purely coupling. The token's entire documented rationale is about
readability of moving text mid-sentence; every number in it was derived from that
constraint. If the transcript is ever re-tuned — and its comment invites exactly
that level of care — this bar silently changes with it, for reasons that have
nothing to do with a progress bar, and nothing in either file records the
dependency.

## Fix

Add a token that says what this is for, with values that preserve today's feel
exactly, then point the chapter strip at it.

1. In `lib/motion/config.ts`, add to the `SPRING` object, after `transcript`:

```ts
  /**
   * Progress fills driven by playback position.
   *
   * Position is republished about four times a second, so a fill that moved
   * only when the value did would step visibly. A slow, softly-damped spring
   * turns those steps back into continuous travel, which is the same job — and,
   * for now, the same numbers — as `transcript`.
   *
   * It is a separate token because the reasons differ. Every figure in
   * `transcript` was measured against text being read mid-sentence; nothing
   * about a 2px bar shares that constraint. Splitting them means the transcript
   * can be re-tuned on its own evidence without silently dragging every
   * progress bar along with it.
   */
  progress: { type: "spring", stiffness: 150, damping: 20, mass: 0.9 } satisfies Transition,
```

2. In `components/player/chapter-strip.tsx`, change line 140:

```tsx
          transition={SPRING.transcript}
```

to:

```tsx
          transition={SPRING.progress}
```

The import line already brings in `SPRING`, so no import change is needed.

**The values are intentionally identical to `SPRING.transcript` today.** This
change must be a visual no-op. Do not "improve" the numbers while moving them —
if the bar should feel different, that is a separate finding with its own
evidence.

## Scope boundaries

- Add exactly one key to `SPRING`. Do **not** modify `snappy`, `pop`, `sheet`, or
  `transcript`, and do not reorder them.
- Change exactly one `transition` prop in `chapter-strip.tsx`.
- Do **not** search out other `SPRING.transcript` uses to convert. The transcript
  component itself (`captions-panel.tsx` line 391,
  `animate(y, target, SPRING.transcript)`) is the token's real owner and must
  keep using it.
- Do not change the bar's `scaleX`, its origin, or its colours.

## Verification

1. `npx tsc --noEmit` passes.
2. `npx vitest run` — 596 tests pass. `lib/motion/config.ts` has no direct test,
   but `caption-motion.test.ts` and others import from it, so a syntax error
   surfaces immediately.
3. **Visual no-op check.** This is the whole verification: play an episode that
   has chapters, open Now Playing, and watch the chapter progress bar advance.
   It must look exactly as it did before — smooth, continuous, no stepping every
   quarter-second. If it now steps, the new token's values were mistyped.
4. Confirm the transcript still scrolls with its measured feel: open the
   transcript panel and watch it advance several lines. It should be unchanged,
   since `SPRING.transcript` was not touched.
5. Grep `SPRING.transcript` and confirm the only remaining consumer is
   `captions-panel.tsx`.
