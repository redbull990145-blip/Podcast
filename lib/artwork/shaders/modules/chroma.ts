/**
 * The colour modules.
 *
 * Like the luminance ones, none of these declares a `displace` body, so none
 * can move a pixel. What they can do is change its colour — which is where
 * "never introduce completely new colours, never use rainbow effects, never use
 * neon" has to be honoured, and honouring it by choosing tasteful constants
 * would not be honouring it at all.
 *
 * Instead every module here is built out of exactly two operations from
 * `lib/oklab.ts`:
 *
 *   - `towardColour(lab, target, amount)` — moves a pixel's chroma toward a
 *     target, holding its lightness. The targets are only ever the swatches
 *     extracted from the artwork itself.
 *   - `scaleChroma(lab, factor)` — moves a pixel along the line between itself
 *     and neutral grey.
 *
 * Neither can reach a hue the cover does not already contain. A rainbow is not
 * something these modules have been told not to produce; it is something they
 * have no way of expressing. Neon is ruled out separately by the fidelity
 * clamp, which bounds how far chroma may travel in a single frame.
 */

import type { ShaderModule } from "../compose";
import { C_PEAK, speed } from "./amplitude";

/**
 * Colour drifting slowly between the artwork's muted and vibrant swatches.
 *
 * The spatial field decides *where* the cover leans vibrant and where it leans
 * muted, and that field drifts — so the colour appears to move through the
 * artwork, pooling and thinning, the way light of slightly varying temperature
 * does across a real surface.
 *
 * Weighted toward muted rather than centred between the two. Vibrant swatches
 * are, by construction, the most chromatic thing on the cover, and a field
 * spending half its time pulling everything toward the most saturated colour
 * present is how ambient colour flow turns into a tint.
 */
export const CHROMA_FLOW: ShaderModule = {
  id: "CHROMA_FLOW",
  tone: /* glsl */ `
    float field = lightField(
      uv,
      time,
      vec2(${speed(0.021, "goldenCubed")}, ${speed(0.016, "golden")}),
      vec2(${speed(-0.013, "unity")}, ${speed(-0.019, "goldenSquared")})
    ) + 0.5;

    vec3 target = mix(uMuted, uVibrant, smoothstep(0.15, 0.95, field));
    lab = towardColour(lab, target, W * ${C_PEAK} * 4.0);
  `,
};

/**
 * Saturation breathing, gated on where there is saturation to breathe.
 *
 * The gate is the whole module. Scaling chroma uniformly would pull colour out
 * of the neutral greys and near-whites that make up most of a typical cover's
 * area — technically a small change, perceptually the cover going slightly
 * sepia and back. Restricting the effect to pixels that already carry chroma
 * means the colours deepen and relax while everything neutral stays exactly
 * neutral, which is what "subtle colour expansion" looks like when it works.
 */
export const CHROMA_EXPAND: ShaderModule = {
  id: "CHROMA_EXPAND",
  tone: /* glsl */ `
    float pulse =
      sin(time * ${speed(0.8, "golden")}) * 0.6 +
      sin(time * ${speed(0.8, "goldenCubed")}) * 0.4;

    float gate = smoothstep(0.015, 0.09, chroma(lab));
    // A fraction of the pixel's own chroma, so the colours deepen and relax
    // rather than being pushed toward anything. Calibrated alongside L_TARGET:
    // an eighth was inaudible at any intensity.
    lab = scaleChroma(lab, 1.0 + pulse * gate * W * 0.45);
  `,
};

/**
 * A slow warm/cool oscillation across the whole frame.
 *
 * Implemented as an oscillation *between two of the artwork's own swatches*
 * rather than along an absolute blue-to-amber axis. An absolute temperature
 * shift is the obvious version and it breaks the rule: pushing a cool green
 * cover toward amber introduces amber, which was never in it.
 *
 * Moving between the cover's lightest and darkest colours produces the same
 * perceptual effect — the artwork feels lit by something that is changing —
 * while staying inside the range of colours it already contained, because those
 * two swatches usually differ in temperature anyway. Nothing new is ever mixed
 * in.
 */
export const TEMP_SHIFT: ShaderModule = {
  id: "TEMP_SHIFT",
  tone: /* glsl */ `
    float swing =
      sin(time * ${speed(0.55, "goldenSquared")}) * 0.62 +
      sin(time * ${speed(0.55, "unity")}) * 0.38;

    // Branchless pick between the two swatches; the swing then supplies how far.
    vec3 target = mix(uDark, uLight, step(0.0, swing));
    lab = towardColour(lab, target, abs(swing) * W * ${C_PEAK} * 2.5);
  `,
};
