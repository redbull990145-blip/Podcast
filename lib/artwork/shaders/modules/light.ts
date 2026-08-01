/**
 * The luminance modules.
 *
 * Seven effects, and not one of them can move a pixel. None declares a
 * `displace` body, so there is no name in scope through which it could write to
 * `offset` — the "do not distort text, logos or typography" rule is satisfied
 * here not by care but by the absence of the capability.
 *
 * That is why most of the engine's perceived life comes from this file. Light
 * is also simply the right thing to animate: a static image looks static
 * because the light in it is frozen, and restoring a sense of the artwork
 * sitting in a room with light moving through it is what makes it feel alive
 * without anything in it having changed.
 */

import type { ShaderModule } from "../compose";
import { L_FIELD, L_SWING, speed } from "./amplitude";

/**
 * Profile 01's backbone. A broad, soft field of light drifting across the
 * artwork.
 *
 * The field *translates* rather than oscillating. An oscillating brightness
 * returns to where it started and the eye finds the turning points; a field
 * scrolled along a fixed heading through noise never returns, so what the
 * viewer perceives is light moving through the scene rather than the scene
 * being brightened and dimmed. The two headings are drawn from different
 * entries in the rate table so the layers never realign.
 */
export const LIGHT_DRIFT: ShaderModule = {
  id: "LIGHT_DRIFT",
  tone: /* glsl */ `
    float field = lightField(
      uv,
      time,
      vec2(${speed(0.03, "golden")}, ${speed(-0.02, "goldenSquared")}),
      vec2(${speed(-0.017, "goldenCubed")}, ${speed(0.026, "unity")})
    );
    lab = addLightness(lab, field * W * ${L_FIELD});
  `,
};

/**
 * A very wide gradient travelling slowly across the frame.
 *
 * Distinct from the drift above in being *directional*: this reads as a source
 * moving past the artwork, where the drift reads as light in the air around it.
 * Two sine components at incommensurable speeds rather than one, so the sweep
 * has no period even though its shape is regular.
 *
 * The axis is fixed rather than following the subject. A sweep that aimed
 * itself at whatever the analysis called the subject would move differently on
 * every cover, and the point of this one is that it is the calm, predictable
 * member of the set — for bright, minimal artwork where anything busier would
 * be the most interesting thing on the screen.
 */
export const LIGHT_SWEEP: ShaderModule = {
  id: "LIGHT_SWEEP",
  tone: /* glsl */ `
    float axis = dot(uv - 0.5, normalize(vec2(0.78, 0.63)));
    float sweep =
      sin(axis * 2.1 - time * ${speed(0.34, "golden")}) * 0.6 +
      sin(axis * 1.3 - time * ${speed(0.34, "goldenCubed")}) * 0.4;
    lab = addLightness(lab, sweep * W * ${L_SWING});
  `,
};

/**
 * Whole-frame luminance breathing. No spatial variation at all.
 *
 * The safest module in the set, and the one that carries the profiles chosen
 * for portraits and for text-heavy covers. Because it applies the same
 * adjustment to every pixel it cannot produce a gradient across a face, cannot
 * create an edge that was not there, and cannot make one part of a title
 * brighter than another. Whatever it does, it does to the whole artwork at
 * once, which is indistinguishable from the room lights changing very slightly.
 *
 * Around a five-second cycle on the primary component — near enough to a
 * resting breath that it feels bodily rather than mechanical, which is the
 * whole of the effect.
 */
export const BREATH: ShaderModule = {
  id: "BREATH",
  tone: /* glsl */ `
    float breath =
      sin(time * ${speed(1.25, "golden")}) * 0.62 +
      sin(time * ${speed(1.25, "goldenSquared")}) * 0.38;
    lab = addLightness(lab, breath * W * ${L_SWING});
  `,
};

/**
 * Light blooming out of the parts of the artwork that are already bright.
 *
 * Reads the top of the mip chain for its blur. That is the single decision that
 * keeps this engine to one draw call: the textbook way to bloom is a separable
 * Gaussian across two render targets, which means extra passes, extra
 * framebuffers and a resize lifecycle — for a blur the driver already computed
 * when it generated mipmaps. `textureLod` at a high level is that blur, free.
 *
 * Gated on the *blurred* lightness rather than the pixel's own, so the glow
 * spreads out of a bright region into its surroundings the way real bloom does,
 * instead of merely making bright pixels brighter.
 */
export const GLOW: ShaderModule = {
  id: "GLOW",
  tone: /* glsl */ `
    vec3 wide = textureLod(uMap, uv, uMaxLod).rgb;
    vec3 wideLab = srgbToOklab(wide);
    float bright = smoothstep(0.5, 0.92, wideLab.x);

    float pulse = 0.5 + 0.5 * (
      sin(time * ${speed(0.9, "goldenSquared")}) * 0.6 +
      sin(time * ${speed(0.9, "unity")}) * 0.4
    );

    lab = addLightness(lab, bright * pulse * W * ${L_SWING});
    // A little of the artwork's own lightest colour comes with the light, which
    // is what stops a glow reading as a grey wash over the top of it.
    lab = towardColour(lab, uLight, bright * pulse * W * 0.25);
  `,
};

/**
 * Soft shadow gathering and releasing, in antiphase to the light.
 *
 * Only ever darkens — `min(field, 0.0)` — so it cannot double as a second light
 * source and produce the busy, two-directional shimmer that two symmetric
 * fields would. Pairing it with `LIGHT_DRIFT` on a different heading gives the
 * impression of a single source moving past something solid, which is what
 * "organic shadow shift" actually is.
 *
 * The colour moves toward the artwork's own darkest swatch rather than toward
 * black. Shadows in the real world take the colour of the ambient light around
 * them, and more practically: darkening toward black desaturates, which would
 * be visibly draining the colour out of the cover.
 */
export const SHADOW: ShaderModule = {
  id: "SHADOW",
  tone: /* glsl */ `
    float field = lightField(
      uv,
      time,
      vec2(${speed(-0.024, "goldenSquared")}, ${speed(0.019, "unity")}),
      vec2(${speed(0.014, "golden")}, ${speed(0.021, "goldenCubed")})
    );
    float shade = min(field, 0.0);

    lab = addLightness(lab, shade * W * ${L_FIELD});
    lab = towardColour(lab, uDark, -shade * W * 0.3);
  `,
};

/**
 * A wide, soft highlight drifting across, as if the artwork were behind glass.
 *
 * The obvious implementation — a Gaussian whose centre is driven by
 * `sin(time)` — was rejected: it sweeps out and back along the same path, and a
 * reflection that retraces itself is the most recognisable loop in this whole
 * set. Here the centre is driven by a noise field instead, so it wanders and
 * never repeats its route.
 *
 * The streak is deliberately enormous — a Gaussian several tenths of the frame
 * across — because a narrow one reads as a flashlight being moved over the
 * artwork rather than as the artwork existing in a lit room.
 */
export const SPECULAR: ShaderModule = {
  id: "SPECULAR",
  tone: /* glsl */ `
    float axis = dot(uv - 0.5, normalize(vec2(0.62, -0.78)));
    float centre = (fbm(vec2(time * ${speed(0.12, "golden")}, 3.7)) - 0.5) * 1.1;
    float d = (axis - centre) * 2.6;
    float streak = exp(-d * d);

    lab = addLightness(lab, streak * W * ${L_SWING});
    lab = towardColour(lab, uLight, streak * W * 0.2);
  `,
};

/**
 * The vignette breathing in and out.
 *
 * Almost every podcast cover already has some falloff at its edges, from a
 * photographic vignette or simply from the composition being centre-weighted.
 * Modulating it very slightly makes the frame feel like it is being lit rather
 * than printed, and it does so entirely in the corners — the region of a cover
 * least likely to contain anything anybody is reading.
 *
 * Darkens only, for the same reason `SHADOW` does: brightening the corners
 * would flatten the image, which is the one direction that makes artwork look
 * worse rather than merely different.
 */
export const VIGNETTE_BREATH: ShaderModule = {
  id: "VIGNETTE_BREATH",
  tone: /* glsl */ `
    float radius = length(uv - 0.5) * 1.414;
    float pulse = 0.5 + 0.5 * (
      sin(time * ${speed(0.7, "goldenCubed")}) * 0.6 +
      sin(time * ${speed(0.7, "golden")}) * 0.4
    );
    float falloff = smoothstep(0.42, 0.95, radius);

    lab = addLightness(lab, -falloff * pulse * W * ${L_SWING});
  `,
};
