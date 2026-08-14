import { describe, expect, it } from 'vitest';
import { canTravel, motionSpec, pressScale, reduceDuration, reducedPolicy } from './reduced.ts';
import { spring } from './springs.ts';
import { duration } from './timing.ts';

describe('motionSpec', () => {
  it('gives the requested spring when motion is welcome', () => {
    expect(motionSpec('expressive', false)).toEqual({ kind: 'spring', ...spring.expressive });
  });

  it('collapses every spring to the same short tween under reduced motion', () => {
    // One tween, not five reduced springs: the point of the policy is that
    // reduced motion looks the same everywhere rather than preserving a
    // hierarchy of weights nobody asked to feel.
    const tokens = ['gentle', 'standard', 'responsive', 'snappy', 'expressive'] as const;
    const specs = tokens.map((token) => motionSpec(token, true));

    for (const spec of specs) {
      expect(spec.kind).toBe('tween');
      expect(spec).toEqual(specs[0]);
    }
  });

  it('never returns a spring under reduced motion', () => {
    // A spring is overshoot, and overshoot is the part that reads as motion.
    expect(motionSpec('snappy', true).kind).toBe('tween');
  });
});

describe('canTravel', () => {
  it('allows travel by default', () => {
    expect(canTravel(false)).toBe(true);
  });

  it('refuses travel under reduced motion', () => {
    expect(canTravel(true)).toBe(false);
  });
});

describe('pressScale', () => {
  it('passes the press-squash straight through by default', () => {
    expect(pressScale(0.92, false)).toBe(0.92);
  });

  it('keeps press feedback under reduced motion rather than removing it', () => {
    // The regression this guards: a component branching to `scale: 1` and
    // leaving a touch control with nothing at all to say it was pressed.
    expect(pressScale(0.92, true)).toBeLessThan(1);
  });

  it('caps the squash at the policy depth', () => {
    expect(pressScale(0.9, true)).toBe(1 - reducedPolicy.maxScaleDelta);
    expect(pressScale(0.92, true)).toBe(1 - reducedPolicy.maxScaleDelta);
  });

  it('leaves an already-gentle press alone instead of deepening it to the cap', () => {
    const gentle = 1 - reducedPolicy.maxScaleDelta / 2;
    expect(pressScale(gentle, true)).toBe(gentle);
  });
});

describe('reduceDuration', () => {
  it('caps anything longer than the base tween', () => {
    expect(reduceDuration(duration.slow)).toBe(duration.base);
  });

  it('leaves shorter durations alone — a 100ms fade is not the problem', () => {
    expect(reduceDuration(duration.instant)).toBe(duration.instant);
  });
});
