import { describe, expect, it } from 'vitest';
import { gesture, rubberBand, settleVelocity, shouldCommit } from './gestures.ts';

describe('rubberBand', () => {
  it('resists but still tracks the finger', () => {
    // The point of resistance is that the thing still moves — an edge that
    // stops dead reads as a frozen UI, not a boundary.
    const moved = rubberBand(100);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(100);
  });

  it('scales linearly with overshoot', () => {
    expect(rubberBand(200)).toBeCloseTo(rubberBand(100) * 2);
  });

  it('preserves direction when dragging back past the other edge', () => {
    expect(rubberBand(-100)).toBeLessThan(0);
  });
});

describe('shouldCommit', () => {
  const total = 600;

  it('commits a fast flick that barely moved', () => {
    // 20px of travel, but thrown hard. This is the case distance-only
    // thresholds get wrong and it is the most common way people dismiss.
    expect(shouldCommit(20, gesture.commitVelocity + 1, total)).toBe(true);
  });

  it('reverses a fast flick thrown the other way', () => {
    expect(shouldCommit(400, -(gesture.commitVelocity + 1), total)).toBe(false);
  });

  it('commits a slow drag past the distance ratio', () => {
    const past = total * gesture.commitDistanceRatio + 1;
    expect(shouldCommit(past, 0, total)).toBe(true);
  });

  it('springs back from a slow drag that did not travel far enough', () => {
    const short = total * gesture.commitDistanceRatio - 1;
    expect(shouldCommit(short, 0, total)).toBe(false);
  });

  it('treats zero travel as non-committal rather than dividing by zero', () => {
    expect(shouldCommit(0, 0, 0)).toBe(false);
  });
});

describe('settleVelocity', () => {
  const travel = 800;

  it('converts screen velocity into progress-per-second', () => {
    // Half the travel per second, so the 0→1 value should move at 0.5/s.
    expect(settleVelocity(400, travel)).toBeCloseTo(0.5);
  });

  it('keeps direction, so a downward throw settles downward', () => {
    expect(settleVelocity(-400, travel)).toBeCloseTo(-0.5);
  });

  it('caps a hard flick instead of letting it overshoot', () => {
    // Trackpads happily report five-figure velocities. Passing one straight
    // into a spring throws the sheet far past its target and back, which reads
    // as a rendering fault rather than as momentum.
    const wild = settleVelocity(50_000, travel);
    expect(wild).toBeCloseTo(gesture.maxSettleVelocity / travel);
  });

  it('caps in the negative direction too', () => {
    expect(settleVelocity(-50_000, travel)).toBeCloseTo(-gesture.maxSettleVelocity / travel);
  });

  it('is zero before the travel distance has been measured', () => {
    // The first client render has not measured the viewport yet. Dividing by
    // it would hand the spring Infinity.
    expect(settleVelocity(400, 0)).toBe(0);
  });
});
