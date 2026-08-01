/**
 * Surface texture.
 *
 * One module, and the most restrained in the engine. It changes lightness only,
 * so like everything in `light.ts` and `chroma.ts` it cannot move a pixel.
 */

import type { ShaderModule } from "../compose";
import { speed } from "./amplitude";

/**
 * Animated grain, at roughly one 8-bit level.
 *
 * Distinct from the dither in `lib/fidelity.ts`, which is a *fixed* screen-space
 * pattern applied to every frame to break up banding. This one moves, and
 * moving grain is a genuinely dangerous effect: at any appreciable amplitude it
 * reads as television static, which is the loudest thing this engine could
 * possibly do.
 *
 * It earns its place because of what happens on artwork that already has grain
 * in it — film photography, halftone print, deliberately degraded illustration.
 * A static image of a grainy photograph is subtly wrong in a way people notice
 * without being able to name: real grain is a property of the *capture*, and
 * the eye half-expects it to shimmer. Restoring a hint of that movement makes
 * such covers feel photographic rather than scanned.
 *
 * Which is also why it is only ever selected for covers the texture metric
 * found grain in. On a clean vector illustration the same effect is just noise
 * added to something that had none.
 *
 * The amplitude is a third of a level at weight 1 — below the threshold at
 * which it can be seen as noise, and only visible as the surface refusing to
 * sit completely still.
 */
export const GRAIN: ShaderModule = {
  id: "GRAIN",
  tone: /* glsl */ `
    // Scrolled in screen space rather than reseeded per frame: a fresh random
    // field every frame flickers at 60Hz, while a fixed field sliding slowly
    // reads as the surface being alive. The two speeds are large because this
    // is the one module meant to move faster than the eye tracks.
    vec2 drift = vec2(time * ${speed(41.0, "golden")}, time * ${speed(37.0, "goldenCubed")});
    float g = ditherNoise(gl_FragCoord.xy + drift) - 0.5;

    lab = addLightness(lab, g * W * 0.0026);
  `,
};
