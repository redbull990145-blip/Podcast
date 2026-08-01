/**
 * The amplitude convention every module is written to.
 *
 * The fidelity clamp in `lib/fidelity.ts` bounds the final output to within
 * `uMaxDelta` of the source. It is tempting to treat that as the amplitude
 * control and let modules push as hard as they like — but a clamp is not a
 * limiter, it is a *clipper*. A module whose natural swing is three times the
 * budget spends most of its time pinned at the boundary, which turns a smooth
 * light field into flat plateaus with hard edges where it comes off the stop.
 * That is far more visible than the motion it was supposed to be hiding.
 *
 * So every module is scaled to peak at roughly six tenths of the budget on its
 * own, and the clamp only ever engages where two or three modules happen to
 * push the same way at the same moment. It stays a safety net rather than
 * becoming the thing shaping the output.
 *
 * These constants exist so that relationship is written down once instead of
 * being re-derived, slightly differently, in thirteen places.
 */

import { RATE } from "../../engine/clock";

/**
 * Peak lightness excursion for one module at weight 1, in Oklab L.
 *
 * **Set against temporal sensitivity, not the just-noticeable difference.** The
 * first version of this file derived the amplitude from a "2 JND" colour budget
 * and produced motion nobody could see at any intensity — about 0.008 in L,
 * roughly two levels out of 255. The error was in the perceptual model, not the
 * arithmetic: a JND describes two patches side by side *at the same instant*,
 * and this engine is doing the opposite thing. A slow, low-spatial-frequency
 * change spread over seconds is the least detectable stimulus the visual system
 * handles, and the threshold for it is several times higher.
 *
 * Calibrated from what the effect has to achieve instead:
 *
 * | ΔL peak | how it reads over a 10–30s cycle |
 * | --- | --- |
 * | 0.01 | nothing at all |
 * | 0.03 | perceptible if you already know to look |
 * | **0.05** | "wait, is this moving?" — the target |
 * | 0.10 | plainly animated |
 *
 * So one module at full weight peaks around 0.05, `subtle` lands near 0.03 and
 * `expressive` near 0.08 — still short of plainly animated, which is the point.
 */
const L_TARGET = 0.11;

/*
 * Two coefficients, not one, because the modules drive them with signals of
 * very different ranges — and using a single constant across all of them was
 * the second reason the motion was invisible.
 *
 * An oscillator (`sin`, or a weighted pair of them) sweeps the full −1..1. A
 * noise field, even after `fbm` is normalised, realistically explores about
 * ±0.22 around its centre, because summed independent octaves cluster near
 * their mean rather than reaching the ends. Feeding both through the same
 * coefficient makes the field modules roughly four times quieter than the
 * oscillator ones, which is exactly the discrepancy that showed up on
 * measurement: a profile built on `LIGHT_DRIFT` moved a couple of levels while
 * one built on `BREATH` moved ten.
 */

/** For signals that sweep −1..1: sines, and unipolar 0..1 envelopes. */
export const L_SWING = L_TARGET.toFixed(5);

/**
 * For noise fields, scaled up by their realistic excursion so that a field
 * module and an oscillator module of equal weight look equally strong.
 *
 * Outliers beyond the typical excursion overshoot the target, which is what the
 * fidelity clamp is for — it is a safety net here rather than the thing shaping
 * the output, because the overshoot is occasional rather than constant.
 */
export const L_FIELD = (L_TARGET / 0.22).toFixed(5);

/**
 * The chroma counterpart.
 *
 * Not in the same units, which is worth stating plainly: the chroma modules use
 * this to scale a *mix fraction* toward one of the artwork's own swatches, not
 * an absolute distance in Oklab. `CHROMA_FLOW` multiplies it by 4, so this value
 * puts a full-weight colour drift at about a quarter of the way toward the
 * target swatch — visible as the colour deepening and thinning, and incapable of
 * reaching a hue the cover does not contain however far it travels.
 */
export const C_PEAK = "0.16";

/**
 * A GLSL float literal for a speed, tied to the rate table.
 *
 * Written this way rather than as a hand-typed constant so the incommensurable
 * ratios in `engine/clock.ts` are actually present in the shader rather than
 * merely intended. A module that wants two speeds asks for two different rates
 * and gets numbers that provably never realign — see the ratio test in
 * `clock.test.ts`.
 */
export function speed(base: number, rate: keyof typeof RATE): string {
  return (base * RATE[rate]).toFixed(6);
}
