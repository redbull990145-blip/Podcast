# Plan 011 — Move the OPML import bar off animated `width`

**Repo commit this plan was written against:** `fcc289b`
**Severity:** LOW (Performance — correct principle, rare surface)
**File:** `components/settings/opml-panel.tsx`

## Problem

`lib/motion/variants.ts` states the performance rule:

> "Only `transform`, `opacity` and small `filter` blurs appear below. Those are
> the properties a compositor can animate without asking the main thread to
> re-layout or repaint."

The OPML import progress bar animates `width`, which is a layout property.
Current code, `components/settings/opml-panel.tsx` lines 152-158:

```tsx
            <div
              className="h-full bg-accent transition-[width] duration-300"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
```

Every step of the import triggers layout on this element and its ancestors. It
is also the only animated `width` left in the codebase — `transition-all` has
already been eliminated everywhere, and the other progress fills either use
`scaleX` (`chapter-strip.tsx`, `elastic-slider.tsx`) or do not transition at all.

Severity is LOW and honestly so: OPML import is a rare, one-time operation, the
bar is small, and the layout cost is not something a user will perceive. This is
worth doing for consistency with the rule the codebase already follows
everywhere else, not because it is slow today.

The `duration-300` is additionally off the token scale (nearest is
`--duration-normal`, 220ms).

## Fix

Switch to a `scaleX` transform with a left origin — the pattern
`components/player/chapter-strip.tsx` already uses for the same job.

Replace lines 152-158 with:

```tsx
            <div
              className="h-full origin-left bg-accent transition-transform duration-[var(--duration-normal)] ease-[var(--ease-out)]"
              style={{
                transform: `scaleX(${progress.total ? progress.done / progress.total : 0})`,
              }}
            />
```

Four changes:

- `width: ${…}%` → `transform: scaleX(…)`, and the value is now a **0-1
  fraction**, not a percentage — drop the `* 100`.
- `transition-[width]` → `transition-transform`.
- `duration-300` → `duration-[var(--duration-normal)]`.
- added `origin-left` so the bar grows from its left edge rather than its centre,
  and `ease-[var(--ease-out)]` to match the rest of the app.

Confirm the parent element still has `overflow-hidden` and a defined width — a
`scaleX` fill needs its track to establish the box, whereas a `width` fill did
not care. Check the wrapping element around line 150; if it lacks a width
constraint the bar will scale relative to an unexpected box.

## Scope boundaries

- Touch **only** the progress-fill element in `components/settings/opml-panel.tsx`.
- Do **not** change the import logic, the `progress` state shape, or the
  surrounding layout.
- Do **not** convert the other `style={{ width }}` bars in the codebase
  (`download-button.tsx`, `downloads-list.tsx`, `continue-row.tsx`,
  `stat-cards.tsx`, `api-keys-panel.tsx`, `captions-panel.tsx`'s skeleton).
  Those set `width` **without** a transition — they are static layout, not
  animation, and converting them is churn with no benefit. `download-button.tsx`
  is addressed separately by plan 013 for a different reason.

## Verification

1. `npx tsc --noEmit` passes.
2. `npx vitest run` — 596 tests pass.
3. **Functional check:** run an OPML import (Settings → import an `.opml` file
   with several feeds). The bar must fill left-to-right and reach the full width
   of its track at completion. A bar that fills from the centre outward means
   `origin-left` did not apply; one that stops short means the fraction is still
   being multiplied by 100 somewhere, or the parent has no width.
4. **The off-by-100 trap:** if the bar jumps to full immediately, the value is
   still a percentage — `scaleX(45)` clamps to a 45× scale, not 45%. Confirm the
   expression produces a number between 0 and 1.
5. In DevTools' Performance panel, record during an import and confirm the bar's
   updates no longer show "Layout" entries attributed to this element. Optional,
   given the low stakes.
