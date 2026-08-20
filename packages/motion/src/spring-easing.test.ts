import { describe, expect, it } from 'vitest';
import { spring, type SpringToken } from './springs.ts';
import { springEasing } from './spring-easing.ts';

const tokens = Object.keys(spring) as SpringToken[];

/** The numbers back out of a `linear(...)` string. */
function stopsOf(easing: string): number[] {
  return easing.slice('linear('.length, -1).split(',').map((part) => Number(part));
}

describe('springEasing', () => {
  it.each(tokens)('%s starts at 0 and ends at exactly 1', (token) => {
    const stops = stopsOf(springEasing(token).easing);
    // Not `toBeCloseTo`. A transition that lands on 0.9997 leaves a permanent
    // sub-pixel offset behind, which is the whole reason the ends are pinned.
    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(1);
  });

  it.each(tokens)('%s settles within a duration a person would sit through', (token) => {
    const { durationMs } = springEasing(token);
    expect(durationMs).toBeGreaterThan(120);
    expect(durationMs).toBeLessThan(1200);
  });

  it.each(tokens)('%s emits only finite samples', (token) => {
    const stops = stopsOf(springEasing(token).easing);
    expect(stops.every(Number.isFinite)).toBe(true);
  });

  /**
   * Overshoot is not uniform across the scale, and should not be.
   *
   * `responsive` (ζ 0.71) and `expressive` (ζ 0.82) are the two the listener
   * manipulates directly, and their single overshoot is what separates a
   * control that feels sprung from one that feels drawn. The other three sit at
   * ζ ≈ 0.93, which overshoots by under a tenth of a percent — arithmetically
   * underdamped, perceptually a clean arrival, which is what ambient drift and
   * a checkmark are supposed to do.
   */
  it.each(['responsive', 'expressive'] as const)('%s overshoots perceptibly', (token) => {
    expect(Math.max(...stopsOf(springEasing(token).easing))).toBeGreaterThan(1.01);
  });

  it.each(['gentle', 'standard', 'snappy'] as const)('%s arrives without a bounce', (token) => {
    expect(Math.max(...stopsOf(springEasing(token).easing))).toBeLessThan(1.005);
  });

  it.each(tokens)('%s does not overshoot so far it reads as a toy', (token) => {
    expect(Math.max(...stopsOf(springEasing(token).easing))).toBeLessThan(1.2);
  });

  it('is monotonic up to its first peak', () => {
    // A step response has no business wobbling on the way out. Catches a sign
    // error in the damped-oscillator solution, which otherwise produces a
    // plausible-looking curve that starts by moving backwards.
    const stops = stopsOf(springEasing('standard').easing);
    const peak = stops.indexOf(Math.max(...stops));
    for (let i = 1; i <= peak; i += 1) {
      expect(stops[i]!).toBeGreaterThanOrEqual(stops[i - 1]!);
    }
  });

  it('gives a heavier spring a longer settle than a snappier one', () => {
    // ω₀ is the only thing that sets this, and it is the assertion that would
    // catch stiffness and mass being raised together — which changes nothing.
    expect(springEasing('expressive').durationMs).toBeGreaterThan(
      springEasing('snappy').durationMs,
    );
  });

  it('produces a value CSS will accept', () => {
    expect(springEasing('standard').easing).toMatch(/^linear\((-?\d+(\.\d+)?, )+1\)$/u);
  });
});
