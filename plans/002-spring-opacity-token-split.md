# Plan 002 — Split opacity onto a tween in `popover`, `dialog`, and `listItem`

**Repo commit this plan was written against:** `f7144a0`
**Severity:** HIGH (Cohesion — single-file fix, cascades to ~10 call sites)
**File:** `lib/motion/variants.ts`

## Problem

`lib/motion/config.ts` documents the app's core motion law in its own header comment:

> "Second, tweens for anything that only *fades or recolours*. Opacity has no momentum in the real world, so a spring on it reads as a wobble."

`lib/motion/variants.ts` follows this correctly in one place and breaks it in three. The correct reference implementation, `fadeUp` (current lines 19-23):

```tsx
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { ...SPRING.pop, opacity: TWEEN.normal } },
  exit: { opacity: 0, y: -4, transition: TWEEN.fast },
};
```

Note the `visible.transition` object: it spreads `SPRING.pop` as the default (applies to `y`, the thing that moves), then overrides the `opacity` key specifically with `TWEEN.normal` — Motion supports per-property transition overrides this way. That's the pattern to replicate.

The three variants that currently do **not** do this (current lines 39-81):

```tsx
export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: SPRING.pop },
  exit: { opacity: 0, scale: 0.97, y: 2, transition: TWEEN.fast },
};

// ...

export const dialog: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: SPRING.sheet },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: TWEEN.fast },
};

// ...

export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: SPRING.pop },
};
```

`popover` alone backs the volume popover, speed-control popover, sleep-timer popover, and `ui/tooltip.tsx` — all high-frequency surfaces — plus both `discover-panel.tsx` and `recommendations-panel.tsx`'s list entries via `listItem`, and every centred modal via `dialog`. This is a one-file fix with wide reach; that's what makes it HIGH leverage rather than a cosmetic nit.

## Fix

Edit `lib/motion/variants.ts`. Change exactly these three `visible` transition lines — do not touch `hidden` or `exit` on any of them, and do not touch `fade`, `sheet`, `backdrop`, `listContainer`, or `pageTransition`, which are already correct or don't apply here (`sheet`'s `y: "100%"` travel legitimately wants the spring on everything since there's no separate opacity channel to split).

### `popover` (currently lines 39-43)

```tsx
export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { ...SPRING.pop, opacity: TWEEN.normal } },
  exit: { opacity: 0, scale: 0.97, y: 2, transition: TWEEN.fast },
};
```

### `dialog` (currently lines 53-57)

```tsx
export const dialog: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 12 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { ...SPRING.sheet, opacity: TWEEN.normal } },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: TWEEN.fast },
};
```

### `listItem` (currently lines 78-81)

```tsx
export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { ...SPRING.pop, opacity: TWEEN.normal } },
};
```

That's the entire code change — three lines, each adding `, opacity: TWEEN.normal` after spreading the existing spring into the `transition` object shorthand (`{ ...SPRING.pop, ... }` instead of bare `SPRING.pop`).

## Scope boundaries

- Only `lib/motion/variants.ts`. No component using these variants (`speed-control.tsx`, `sleep-timer.tsx`, `volume-control.tsx`, `ui/tooltip.tsx`, `discover-panel.tsx`, `recommendations-panel.tsx`, both dialog call sites) needs any change — they consume the variant object by name and inherit the fix automatically.
- Do not add a new token to `lib/motion/config.ts`; `TWEEN.normal` already exists and is the correct choice (it's what `fadeUp` and `fade` both use for opacity).
- Do not change `SPRING.pop` or `SPRING.sheet` themselves.

## Verification

1. `npm run typecheck` should pass — this is a pure value change inside an already-typed `Variants` object, no type surface changes.
2. Visually: open the volume popover, speed-control popover, and sleep-timer popover (all use `popover`) and a centred dialog (search the codebase for `variants.dialog` or `dialog` import if unsure which component renders one — likely a confirmation or the "Generate captions" flow). Before the fix, opacity and scale/y are locked to the same spring curve; after, opacity should complete on `TWEEN.normal`'s smooth 220ms fade while scale/position still springs. The visible difference is subtle by design — this is a correctness/consistency fix, not a dramatic visual change. If it looks identical, that's expected; the goal is removing exactly the "wobble" described in the source comment.
3. Feel-check in slow motion: most browser devtools (Chrome DevTools → Rendering tab → "Emulate CSS media feature prefers-reduced-motion" is unrelated; instead use the Animations panel under More Tools → Animations, or record a screen capture and step frame-by-frame) — confirm opacity now rises monotonically to 1 without the faint overshoot/settle wobble a spring can introduce, while scale/y still visibly springs.
4. Check `listItem` specifically in `discover-panel.tsx`'s search results and `recommendations-panel.tsx`'s cards — these mount several items via `listContainer`'s stagger, so the effect (if perceptible) will be more visible across a group than a single popover.
