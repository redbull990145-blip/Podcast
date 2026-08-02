# Plan 013 — Let the download progress bar move instead of jump

**Repo commit this plan was written against:** `fcc289b`
**Severity:** LOW (Missed opportunity — additive, not corrective)
**File:** `components/downloads/download-button.tsx`

## Problem

This is not a bug. Nothing here is wrong; there is simply no motion where motion
would say something.

The download button carries a 20px progress bar under its icon. Current code,
`components/downloads/download-button.tsx` lines 126-133:

```tsx
      {state === "downloading" && percent > 0 && (
        <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full bg-accent"
            style={{ width: `${percent}%` }}
          />
        </span>
      )}
```

`percent` is set from download progress events, which arrive irregularly and in
uneven increments — a chunk completing can jump the value several percent at
once. With no transition, the bar teleports between those values. On a 20px-wide
bar, a jump from 40% to 55% is a 3px hop, which reads as the bar glitching rather
than as progress being made.

A short transition turns the same data into continuous travel, which is the one
thing a progress indicator is for: conveying that something is still happening
between updates.

## Fix

Use `scaleX` with a transition, matching the pattern used by
`chapter-strip.tsx` and `elastic-slider.tsx`.

Replace lines 128-131 with:

```tsx
          <span
            className="block h-full origin-left bg-accent transition-transform duration-[var(--duration-normal)] ease-[var(--ease-out)]"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
```

Three changes:

- `width: ${percent}%` → `transform: scaleX(${percent / 100})`. Note the **/100**:
  `scaleX` takes a 0-1 fraction, and `percent` is 0-100.
- added `transition-transform` with `--duration-normal` (220ms) and
  `--ease-out`, the app's standard settle curve.
- added `origin-left` so the bar grows from its left edge.

220ms is chosen to be long enough to visibly travel between updates without
still animating when the next one lands. If downloads on a fast connection
produce updates closer together than that, the bar will chase and never settle —
if that happens, drop to `--duration-fast` (140ms) rather than removing the
transition.

The outer `<span>` already has `overflow-hidden` and a fixed `w-5`, so the track
box is well defined and the scale will behave.

## A note on what NOT to generalise

Several other components set `style={{ width }}` without a transition:
`downloads-list.tsx` (lines 197-198), `continue-row.tsx` (line 94),
`stat-cards.tsx` (line 117), `api-keys-panel.tsx` (line 246), and
`captions-panel.tsx` (line 161, a loading skeleton).

**Leave every one of them alone.** They render a value that is already final when
the component mounts — a stored playback position, a disk-usage share, a quota.
Nothing about them changes while the user is looking, so a transition would
animate on mount and then never fire again, which is decoration rather than
information. This plan applies only to the download bar because its value
genuinely updates live.

## Scope boundaries

- Touch **only** the inner progress `<span>` in `download-button.tsx`.
- Do **not** change the `state === "downloading" && percent > 0` condition, the
  icon, or the button's own `transition-colors`.
- Do **not** add an enter/exit animation for the bar appearing and disappearing.
  That is a separate judgement and is not part of this finding.
- Do not convert the other width-based bars listed above.

## Verification

1. `npx tsc --noEmit` passes.
2. `npx vitest run` — 596 tests pass.
3. **Functional check:** start downloading an episode and watch the bar under the
   icon. It should glide between progress updates rather than hopping, and must
   still reach the full width of its 20px track at 100%.
4. **The off-by-100 trap:** if the bar is instantly full, `percent / 100` was
   missed and it is being given a scale of e.g. 45 instead of 0.45.
5. **Feel-check on a slow connection** (DevTools → Network → throttle to "Slow
   4G"). Updates arrive further apart, which is where the transition earns its
   place: the bar should read as continuously advancing. Then check an
   already-cached/fast download — if the bar visibly lags behind a download that
   finishes in under a second, reduce to `--duration-fast`.
6. Confirm the bar disappears cleanly when the download completes and `state`
   leaves `"downloading"`.
