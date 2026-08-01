/**
 * The travelling sheen.
 *
 * A soft, wide band of the artwork's own brightest and most vibrant colour,
 * sweeping steadily across the frame and re-entering from the other side. This
 * is the module you actually see — everything else in the engine modulates
 * light in place, and modulation in place turns out to be far below the
 * threshold at which anyone notices a picture is alive.
 *
 * Two details make the loop invisible despite being a hard `fract()` cycle:
 *
 *   1. **The band starts and finishes off screen.** The centre sweeps from
 *      −1.25 to +1.25 while the projected axis only spans about ±0.71, and the
 *      band is a Gaussian that has decayed to nothing well before either end.
 *      So at the moment the cycle wraps there is nothing on screen to jump.
 *   2. **The travel is eased, not linear.** A constant-velocity band reads as a
 *      scanner. `smoothstep` on the cycle makes it drift in, cross, and ease
 *      out, which is what light moving past a window does.
 *
 * It cannot distort anything. There is no `displace` body here, so no pixel
 * moves — the band only changes the lightness and chroma of what is already
 * there, and the chroma only ever moves toward a swatch extracted from this
 * cover. A logo under the sheen brightens; it does not bend, and it cannot
 * become a colour the artwork did not contain.
 */

import type { ShaderModule } from "../compose";
import { speed } from "./amplitude";

/**
 * How bright the band gets at its centre, in Oklab L.
 *
 * Set from what is actually visible rather than from a colour-difference
 * threshold. Two earlier calibrations aimed at "perceptible on close
 * inspection" and produced motion nobody could see at any intensity; this one
 * is meant to be noticed, which is what was asked for.
 */
const SHEEN_LIGHT = "0.17";

/** How far the band pulls colour toward the cover's vibrant swatch, 0–1. */
const SHEEN_CHROMA = "0.45";

/**
 * Width of the Gaussian, as a fraction of the projected axis.
 *
 * Wide on purpose. A narrow band is a scanner line and looks like a loading
 * state; a wide one reads as a change in the light falling on the artwork.
 */
const SHEEN_WIDTH = "0.34";

export const SHEEN: ShaderModule = {
  id: "SHEEN",
  tone: /* glsl */ `
    // Diagonal, so the band crosses the composition rather than running
    // parallel to a typical cover's horizontal bands of type.
    vec2 heading = normalize(vec2(0.74, 0.67));
    float axis = dot(uv - 0.5, heading);

    // One eased traverse per cycle. The band is fully off screen at both ends
    // of the range, so the wrap has nothing to reveal.
    float cycle = fract(time * ${speed(0.16, "golden")});
    float centre = mix(-1.25, 1.25, smoothstep(0.0, 1.0, cycle));

    float d = (axis - centre) / ${SHEEN_WIDTH};
    float band = exp(-d * d);

    // A second, fainter band on an incommensurable cycle and the opposite
    // heading. Two passes that never coincide stop the effect resolving into a
    // countable rhythm, which is what makes a single sweep feel mechanical.
    float cycleB = fract(time * ${speed(0.16, "goldenCubed")} + 0.37);
    float centreB = mix(1.25, -1.25, smoothstep(0.0, 1.0, cycleB));
    float dB = (dot(uv - 0.5, vec2(-heading.y, heading.x)) - centreB) / ${SHEEN_WIDTH};
    float bandB = exp(-dB * dB) * 0.55;

    float sheen = min(1.0, band + bandB);

    lab = addLightness(lab, sheen * W * ${SHEEN_LIGHT});
    lab = towardColour(lab, uVibrant, sheen * W * ${SHEEN_CHROMA});
  `,
};
