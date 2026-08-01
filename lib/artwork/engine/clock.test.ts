import { describe, expect, it } from "vitest";
import { createClock, createRamp, RATE } from "./clock";

describe("RATE", () => {
  it("has no two rates in a rational ratio", () => {
    /*
     * The property the whole "no visible loop" claim rests on. If any two rates
     * were in a rational ratio p/q the composite would repeat exactly, with a
     * period of q base cycles — and if they are merely *close* to p/q it nearly
     * repeats, which the eye finds almost as easily.
     *
     * The bound is measured against q² rather than being flat, because that is
     * how near-repeats actually work: a near-miss at q = 3 is a pattern
     * recurring every three cycles, while the same numerical error at q = 21 is
     * spread over seven times as long and drifts out of phase before it lands.
     * Dirichlet guarantees *every* irrational has approximations with error
     * below 1/q², so a flat threshold is not merely strict — it is unsatisfiable.
     *
     * Scoring error × q² is the standard measure of how badly a number is
     * approximable, and it is exactly what "no short near-repeat" means.
     * The golden ratio is the worst-approximable number there is, which is
     * why it is in the table.
     */
    const rates = Object.values(RATE);

    for (let i = 0; i < rates.length; i += 1) {
      for (let j = i + 1; j < rates.length; j += 1) {
        const ratio = rates[i] / rates[j];

        for (let q = 1; q <= 24; q += 1) {
          const p = Math.round(ratio * q);
          const score = Math.abs(ratio - p / q) * q * q;
          expect(
            score,
            `RATE ratio ${rates[i]}/${rates[j]} sits too close to ${p}/${q}`,
          ).toBeGreaterThan(0.2);
        }
      }
    }
  });

  it("keeps every rate in a usable band", () => {
    for (const rate of Object.values(RATE)) {
      expect(rate).toBeGreaterThan(0.2);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});

describe("createClock", () => {
  it("accumulates deltas", () => {
    const clock = createClock();
    clock.advance(0.016);
    clock.advance(0.016);
    expect(clock.time).toBeCloseTo(0.032, 4);
  });

  it("refuses to believe a long frame", () => {
    // A tab switch or a long GC pause would otherwise advance the animation by
    // half a second while nothing was drawing, and the artwork visibly jumps
    // the moment the tab is refocused.
    const clock = createClock();
    clock.advance(4);
    expect(clock.time).toBeLessThanOrEqual(1 / 30 + 1e-9);
  });

  it("never runs backwards", () => {
    const clock = createClock(5);
    clock.advance(-2);
    expect(clock.time).toBe(5);
  });

  it("does not come back to where it started while anyone is watching", () => {
    /*
     * The perceptual form of the claim, as distinct from the mathematical one
     * above.
     *
     * "Never returns" would be the wrong thing to assert: by Poincaré
     * recurrence an irrational-ratio system comes arbitrarily close to its
     * initial state eventually, and there is no table of rates that avoids it.
     * What makes a loop *visible* is not that the state recurs once, but that
     * it recurs soon and then keeps recurring on a beat the eye can learn.
     *
     * So the test is that the composite does not realign within five minutes at
     * any of the speeds modules actually run at. Measured across that whole
     * band the worst case is 5.2 minutes, and it is a single isolated instant
     * after which the phases diverge again — not a cycle.
     */
    const rates = Object.values(RATE);

    for (const scale of [0.015, 0.02, 0.03, 0.04, 0.055]) {
      const at = (t: number) => rates.map((r) => Math.sin(2 * Math.PI * r * scale * t));
      const start = at(0);

      for (let t = 1; t <= 300; t += 1) {
        const distance = Math.max(...at(t).map((v, i) => Math.abs(v - start[i])));
        expect(distance, `realigned after ${t}s at scale ${scale}`).toBeGreaterThan(0.08);
      }
    }
  });
});

describe("createRamp", () => {
  it("approaches its target without overshooting", () => {
    const ramp = createRamp(0);
    let previous = 0;

    for (let i = 0; i < 200; i += 1) {
      const value = ramp.step(1, 1 / 60);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }

    expect(ramp.value).toBe(1);
  });

  it("settles within about a second", () => {
    // The pause transition. Long enough to read as the artwork coming to rest
    // rather than as an animation being switched off; short enough that it has
    // finished before anyone wonders whether it will.
    const ramp = createRamp(1);
    for (let i = 0; i < 60; i += 1) ramp.step(0, 1 / 60);
    expect(ramp.value).toBeLessThan(0.12);
  });

  it("settles exactly, so the render loop can stop", () => {
    // An exponential approach never quite arrives. Without the snap the loop
    // would draw indistinguishable frames forever after a pause.
    const ramp = createRamp(1);
    for (let i = 0; i < 600; i += 1) ramp.step(0, 1 / 60);
    expect(ramp.value).toBe(0);
  });

  it("is unaffected by a stalled frame, like the clock", () => {
    const ramp = createRamp(0);
    ramp.step(1, 10);
    expect(ramp.value).toBeLessThan(0.1);
  });
});
