# Improvement plans

Mostly animation work, from two `/improve-animations` audits — the first against
commit `f7144a0` (plans 001-004), the second against `fcc289b` (plans 006-013).
Plan 005 is unrelated and came from a caption-synchronisation investigation.

Note: this environment's copy of the `improve-animations` skill is missing its
`AUDIT.md` rule catalog and `PLAN-TEMPLATE.md`, in both runs. The audit rubric
and this plan format were reconstructed from established motion-design practice
rather than pulled from those files. The findings themselves were verified
directly against this codebase either way.

## Status

| Plan | Finding | Status |
| --- | --- | --- |
| [001-captions-skeleton-reduced-motion.md](001-captions-skeleton-reduced-motion.md) | Captions-loading skeleton ignores both reduced-motion mechanisms and duplicates the app's own `.skeleton` pattern | **DONE** |
| [002-spring-opacity-token-split.md](002-spring-opacity-token-split.md) | `popover`/`dialog`/`listItem` variants spring opacity instead of tweening it, against the system's own documented rule | **DONE** |
| [003-episode-row-checkmark-origin.md](003-episode-row-checkmark-origin.md) | "Played" checkmark badge grows from `scale: 0`, the app's own documented anti-pattern | **DONE** |
| [004-artwork-animation-engine.md](004-artwork-animation-engine.md) | Living-artwork shader engine | **DONE** |
| [005-caption-sync-accuracy.md](005-caption-sync-accuracy.md) | Caption drift is upstream, not in the renderer: chunk offsets are derived from transcribed content rather than audio duration, so error accumulates across every chunk boundary | **§1 DONE**, §2-4 TODO |
| [006-seek-thumb-scale-origin.md](006-seek-thumb-scale-origin.md) | Seek-bar thumb still grows from `scale-0` with an overshooting ease — the same anti-pattern 003 fixed, in the shared `Slider` | **DONE** |
| [007-elastic-slider-reduced-motion.md](007-elastic-slider-reduced-motion.md) | `ElasticSlider` has no reduced-motion gating at all (imperative `animate()` bypasses `MotionConfig`), and its snap-back spring is an ungoverned 600ms | **DONE** |
| [008-cover-nudge-spring-token.md](008-cover-nudge-spring-token.md) | Now Playing's cover pause-nudge uses `SPRING.sheet` — the long-travel token — for a 6% scale on the most-pressed control | **DONE** |
| [009-skip-button-gesture-bundle.md](009-skip-button-gesture-bundle.md) | Skip buttons hardcode one gesture for both sizes, inverting `gestures.ts`'s "scale inversely proportional to size" rule | **DONE** |
| [010-duration-token-alignment.md](010-duration-token-alignment.md) | Ten stray durations (`duration-150/200/300/500`, `0.24`) sit beside the token scale rather than on it — widest reach is the shared `Button` | **DONE** |
| [011-opml-progress-scalex.md](011-opml-progress-scalex.md) | OPML import bar animates `width`, the last animated layout property in the codebase | **DONE** |
| [012-chapter-progress-spring-token.md](012-chapter-progress-spring-token.md) | Chapter progress bar borrows `SPRING.transcript`, a spring measured specifically for reading text | **DONE** |
| [013-download-progress-transition.md](013-download-progress-transition.md) | Download progress bar jumps between updates instead of travelling (missed opportunity, additive) | **DONE** |

### Second audit (`fcc289b`) — what was rejected

- **`components/ui/slider.tsx:132`'s `transform 260ms linear` glide.** Flagged as
  a non-interruptible tween. Rejected: it deliberately interpolates a
  *constant-rate* playback clock between ~4Hz position ticks, and linear is
  correct for that — easing would make playback position visibly accelerate and
  decelerate within every tick. Documented in place; left alone.
- **`components/artwork/animated-artwork.tsx`'s reduced-motion handling.**
  Checked and found correct (`!reducedMotion` gates `enabled`, plus
  `motionDisabled` into `selectProfile` and a `gaveUp` WebGL fallback). No finding.
- **`transition-all`** — previously deferred from the first audit, now gone from
  the codebase entirely. Resolved.
- **Static `style={{ width }}` bars** in `downloads-list`, `continue-row`,
  `stat-cards`, `api-keys-panel`. They render an already-final value and never
  change while on screen, so a transition would be decoration. Left alone (see
  plan 013).

### Deviations from the plans as written

- **001** kept the placeholder's dark `bg-white/10` instead of inheriting `Skeleton`'s `bg-surface-raised`, which is a light sand and wrong on Now Playing's permanently-dark backdrop. The shared `.skeleton` sweep was also tinted per-instance: it mixed 7% of `--foreground`, which in light mode is near-black and therefore invisible against that panel. `.skeleton` now exposes `--skeleton-sheen` for exactly this case. `Skeleton` gained the `style` passthrough the plan specified.
- **003** used `scale: 0.5` as specified, and additionally split opacity onto `TWEEN.fast`, for the same reason as 002 — the plan predated that change and would have left this one call site springing opacity.

## Recommended execution order

### First audit (001-003) — all complete

1. **002 first.** It's a 3-line change confined to `lib/motion/variants.ts` with no component-level edits, so it's the lowest-risk and fastest to land, and it improves several surfaces (popover, dialog, listItem) at once.
2. **003 next.** Single-file, single-component change in `episode-row.tsx`, independent of 001 and 002.
3. **001 last.** Slightly larger in scope (touches two files — `captions-panel.tsx` and `components/ui/page.tsx`'s shared `Skeleton`) and is worth its own focused review pass given it's an accessibility fix, not just a polish fix.

### Second audit (006-013)

1. **007 first.** The only accessibility gap, on a hot surface, and the largest
   single edit of the batch. Everything else is cosmetic by comparison.
2. **006, 008, 009** next, in any order. Each is a one-to-three line change in a
   different file, all HIGH or MEDIUM, all independently verifiable.
3. **010** after those. It is mechanical but touches nine files, so landing it
   last among the felt fixes keeps their diffs readable. **Sequence it after 006,
   which edits `slider.tsx:187`'s `duration-150` as part of its own change** —
   running 010 first would leave 006 with a conflicting edit on that line.
4. **012, 011, 013** last. Low stakes; 012 is a deliberate visual no-op, 011 and
   013 are small and localised.

### Dependencies and conflicts

- **006 → 010.** Both touch a `duration-150`; 006 owns `slider.tsx:187` and 010
  explicitly excludes it. Run 006 first, or run them in the same worktree.
- **007 is the sole owner of `elastic-slider.tsx`.** It merges what would
  otherwise be two plans (reduced motion, and the ungoverned spring) precisely so
  that two executors cannot collide in that file.
- **011 and 013 both convert a `width` fill to `scaleX`**, but in different files
  with an explicit non-overlap note in each. Safe to parallelise.
- Otherwise no plan depends on another. Each is self-contained — an executor
  needs no context from the originating conversation.

### Verification note

Every plan in the second batch carries a feel-check step, and several of them
(007's spring change, 008's whole premise, 013's duration) **cannot be judged
from the code alone**. The test suite asserts nothing about any of this — 596
tests pass identically before and after.

**What was actually verified when 006-013 landed**, so the DONE marks above are
not read as more than they are:

Machine-checked in a browser:

- `duration-[var(--duration-*)]` resolves rather than failing silently — the
  main risk in **010**. `Button`'s computed `transition-duration` is `0.14s`,
  and `--duration-fast/normal/slow` resolve to `.14s/.22s/.38s`.
- **006** end to end: the thumb's computed `scale` is `0.5` at rest (not `0`),
  `transition-duration` is `0.14s`, the transition property list includes
  `scale`, and Tailwind emits
  `.group-hover\/slider\:scale-100 … { scale: 100% }`. Note Tailwind v4 compiles
  `scale-50` to the standalone `scale` property, not `transform` — checking
  `transform` alone shows `none` and looks like a failure when it isn't.
- **007**'s fill renders at the right position (`scaleX(0.55)` for a value of 55)
  with a matching `aria-valuenow`.

Not verified, and left for whoever next has the app open:

- **Reduced motion (007's whole point).** Needs DevTools' "Emulate CSS media
  feature prefers-reduced-motion", which cannot be driven from the preview pane.
  Both the gated and ungated paths still need a look — the ungated one especially,
  since a gate applied too broadly would silently kill the elastic effect for
  everyone.
- **Every feel-check.** 007's `SPRING.pop` snap-back, 008's cover-nudge timing
  against the play button, 009's large-vs-small press comparison. These are the
  reasons the changes were made and none of them has been looked at.
- **011 and 013** have not been run at all — they need a real OPML import and a
  real download in flight. Both convert a percentage to a 0-1 `scaleX` fraction,
  which is exactly the edit that silently pins a bar to full if the `/100` is
  dropped.

## Deferred

The first audit's deferred list has now been worked through by the second audit.
Of it: `SPRING.sheet`-on-a-6%-nudge became **008**, skip-button scaling became
**009**, the `duration-150` near-misses became **006** and **010**,
`opml-panel.tsx` became **011**, `download-button.tsx` became **013**, and
`player-bar.tsx`'s exit duration folded into **010**. `transition-all` was found
to be gone from the codebase entirely.

Still deferred:

- **One-off gesture values in `captions-panel.tsx`** (line 490's
  `whileTap: { scale: 0.94 }`, lines 918-920's `1.03`/`0.96`). Same class as plan
  009 but on occasional surfaces; deliberately excluded from 009 to keep that
  plan's diff to one file.
- **Four of the first audit's five missed-opportunity notes** — alert-banner
  entrances, list-item removal exits, AI panel content reveals, numeric readout
  crossfades. The second audit's missed-opportunity sweep was cut short (three of
  four parallel audit agents were terminated by a session limit), so these were
  not re-verified against current code and may already be addressed by the Now
  Playing rework or the elastic slider. Only the progress-fill item was
  confirmed still open, and it became plan 013.

Re-run `/improve-animations plan <description>` for any of these individually,
or `/improve-animations` again to re-triage.
