import { motionSpec, reducedTween, spring } from '@cue/motion';
import { describe, expect, it } from 'vitest';
import { toTransition } from './motion.ts';

describe('toTransition', () => {
  it('passes spring physics through untouched', () => {
    expect(toTransition(motionSpec('expressive', false))).toEqual({
      type: 'spring',
      ...spring.expressive,
    });
  });

  it('drops the discriminant rather than handing Motion an unknown key', () => {
    expect(toTransition(motionSpec('standard', false))).not.toHaveProperty('kind');
    expect(toTransition(motionSpec('standard', true))).not.toHaveProperty('kind');
  });

  it('converts the reduced tween from milliseconds to seconds', () => {
    // The token scale is in ms and Motion's tween takes seconds. Getting this
    // backwards produces a two-minute fade, not an error — so it is worth a
    // test even though it is one division.
    const transition = toTransition(motionSpec('snappy', true));
    expect(transition).toMatchObject({ duration: reducedTween.duration / 1000 });
    expect(transition).toMatchObject({ duration: 0.12 });
  });

  it('gives the reduced tween a curve Motion can read', () => {
    const transition = toTransition(motionSpec('gentle', true));
    expect(transition).toMatchObject({ ease: [...reducedTween.easing] });
  });

  it('never returns a spring for a reduced spec', () => {
    for (const token of ['gentle', 'standard', 'responsive', 'snappy', 'expressive'] as const) {
      expect(toTransition(motionSpec(token, true))).not.toHaveProperty('type', 'spring');
    }
  });
});
