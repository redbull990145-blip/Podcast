/**
 * The only two modules that can move a pixel.
 *
 * Both write to `offset`, and both are checked at import time by `assertMasked`
 * for the `freedom` term that gates them on the protection mask. Between that
 * check and the two-band recombination in `compose.ts` — which is applied by
 * `main()` rather than by anything here, so it cannot be opted out of — the
 * displacement these produce reaches only the soft, low-frequency part of the
 * artwork, only in regions with no text, no logo, no hard edge and no face.
 *
 * Two independent mechanisms, either of which alone would be enough. That is
 * deliberate: this is the file where a mistake would show up as a smeared glyph
 * on somebody's podcast cover, so it is the file that gets belt and braces.
 */

import type { ShaderModule } from "../compose";
import { speed } from "./amplitude";

/**
 * Displacement budget, in UV units against the 640px texture.
 *
 * `0.0039 × 640 ≈ 2.5px`, which is the middle of the 1–3px range the effect is
 * specified for. Worth being concrete about how small that is: it is a quarter
 * of the width of a lowercase stem at this resolution, applied only to a band
 * that has been blurred to a 40px radius. What makes it read as depth is not
 * the distance travelled but the fact that the soft field moves while the sharp
 * one does not — relative motion is what the visual system extracts depth from,
 * and it is extraordinarily sensitive to it.
 */
const PARALLAX = "0.0039";

/**
 * The background drifting behind the foreground.
 *
 * The motion is a sum of two oscillators per axis at incommensurable rates, so
 * the drift wanders rather than tracing a repeating figure. Very slow — the
 * full excursion takes the better part of a minute — because parallax is the
 * one effect here that is genuinely *motion* rather than a change in light, and
 * motion is what the eye is built to detect.
 *
 * Selected only for covers where the analysis found a real foreground and
 * background to separate. On a flat graphic there is nothing behind anything
 * and this produces a subtle, pointless smear.
 */
export const DEPTH_BAND: ShaderModule = {
  id: "DEPTH_BAND",
  displace: /* glsl */ `
    vec2 drift = vec2(
      sin(time * ${speed(0.31, "golden")}) * 0.62 +
      sin(time * ${speed(0.31, "goldenCubed")}) * 0.38,

      sin(time * ${speed(0.27, "goldenSquared")}) * 0.58 +
      sin(time * ${speed(0.27, "unity")}) * 0.42
    );

    offset += drift * ${PARALLAX} * W * freedom;
  `,
};

/**
 * A gentle undulation of the surface itself.
 *
 * Where `DEPTH_BAND` translates the whole background rigidly, this warps it —
 * the displacement varies across the frame, so the artwork appears to breathe
 * over a very shallow curve rather than slide. The difference is the same one
 * between a photograph being moved and a photograph printed on silk.
 *
 * Half the amplitude of the parallax, because a spatially varying displacement
 * is far more visible than a uniform one at equal magnitude: a rigid shift of
 * everything is something the eye discounts as camera movement, while a warp
 * has no such explanation and registers immediately.
 *
 * The domain warp comes from the same noise the light fields use, at a low
 * frequency, so the surface undulates on the same scale as the light moving
 * over it rather than at a scale of its own.
 */
export const SURFACE: ShaderModule = {
  id: "SURFACE",
  displace: /* glsl */ `
    vec2 warped = warp(uv, time, 0.35);
    vec2 undulation = vec2(
      fbm(warped * 1.7 + vec2(${speed(0.02, "golden")} * time, 0.0)) - 0.5,
      fbm(warped * 1.7 + vec2(9.1, ${speed(0.017, "goldenSquared")} * time)) - 0.5
    );

    offset += undulation * ${PARALLAX} * 0.5 * W * freedom;
  `,
};
