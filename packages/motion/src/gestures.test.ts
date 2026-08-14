import { describe, expect, it } from 'vitest';
import { gesture, rubberBand, shouldCommit } from './gestures.ts';

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
