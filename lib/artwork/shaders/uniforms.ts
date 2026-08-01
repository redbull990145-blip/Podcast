/**
 * Builds the uniform object a composed shader expects.
 *
 * Deliberately free of any `three` import. Three's uniform format is just
 * `{ name: { value } }`, and vector uniforms accept plain arrays, so nothing
 * here needs the library — which keeps the engine's core independent of the
 * renderer that happens to drive it. If the R3F host is ever swapped for raw
 * WebGL, this file is unaffected.
 */

import { srgbToOklab, toVec3 } from "../palette/oklab";
import type { ArtworkSwatches } from "../palette/swatches";
import { BASE_MAX_DELTA, MAX_MODULES } from "../types";
import type { ArtworkFeatures } from "../analysis/analyse";

/** A three-compatible uniform. */
type Uniform<T> = { value: T };

export type ArtworkUniforms = {
  uMap: Uniform<unknown>;
  uMask: Uniform<unknown>;
  uTime: Uniform<number>;
  uIntensity: Uniform<number>;
  uMaxDelta: Uniform<number>;
  uWeights: Uniform<number[]>;
  uVibrant: Uniform<[number, number, number]>;
  uDominant: Uniform<[number, number, number]>;
  uMuted: Uniform<[number, number, number]>;
  uDark: Uniform<[number, number, number]>;
  uLight: Uniform<[number, number, number]>;
  uSubject: Uniform<[number, number]>;
  uMaxLod: Uniform<number>;
  uDepthLod: Uniform<number>;
};

/**
 * Widest mip level a 640px texture provides.
 *
 * The blur-based modules read the top of the mip chain instead of running a
 * separable Gaussian across a pair of render targets. `log2(640) ≈ 9.32`, and
 * the last couple of levels are a handful of texels describing the whole
 * image — too coarse to be a blur and prone to bleeding the frame's edges
 * inward. Level 6 is a roughly 64px radius, which is the widest that still
 * looks like light rather than like a colour wash.
 */
const MAX_USEFUL_LOD = 6;

/**
 * Where the artwork is split into "background" and "detail" for parallax.
 *
 * Level 4 of a 640px texture is a 40px effective radius. The band above it —
 * everything the blur removed — is what gets held still, and it has to contain
 * *all* of the typography, or a glyph ends up partly in the moving band.
 * Podcast covers render their smallest legible type at around 14–20px at this
 * size, comfortably inside 40.
 *
 * Going wider would be safer for text but starts moving genuinely large shapes,
 * at which point the parallax stops reading as depth and starts reading as the
 * image sliding.
 */
const DEPTH_LOD = 4;

export function createUniforms(
  swatches: ArtworkSwatches,
  features: ArtworkFeatures,
  weights: number[],
): ArtworkUniforms {
  return {
    // Both textures are attached by the renderer once loaded; until then the
    // canvas has not been shown, so their initial value is never sampled.
    uMap: { value: null },
    uMask: { value: null },

    uTime: { value: 0 },
    // Starts at zero and is ramped up by the render loop, so the very first
    // frame the canvas draws is identical to the static image it is fading in
    // over. Any other starting value would make the handover visible.
    uIntensity: { value: 0 },
    uMaxDelta: { value: 0 },

    uWeights: { value: padWeights(weights) },

    uVibrant: { value: toVec3(srgbToOklab(swatches.vibrant)) },
    uDominant: { value: toVec3(srgbToOklab(swatches.dominant)) },
    uMuted: { value: toVec3(srgbToOklab(swatches.muted)) },
    uDark: { value: toVec3(srgbToOklab(swatches.dark)) },
    uLight: { value: toVec3(srgbToOklab(swatches.light)) },

    uSubject: { value: [features.subject.centroid.x, features.subject.centroid.y] },
    uMaxLod: { value: MAX_USEFUL_LOD },
    uDepthLod: { value: DEPTH_LOD },
  };
}

/**
 * The deviation budget for a given intensity.
 *
 * Scaled by intensity rather than fixed, which is what makes intensity a single
 * honest control: turning it down does not merely quieten the modules, it
 * tightens the bound on how far the output may sit from the artwork. At zero
 * the bound is zero and the shader is provably an identity function.
 */
export function maxDeltaFor(intensity: number): number {
  return BASE_MAX_DELTA * intensity;
}

/**
 * Pads to the fixed array length the shader declares.
 *
 * GLSL array uniforms have a compile-time size, and three uploads exactly as
 * many floats as the array declares — a short JavaScript array leaves the tail
 * at whatever the previous program left there, which would give unused module
 * slots a nonzero weight.
 */
function padWeights(weights: number[]): number[] {
  const padded = new Array<number>(MAX_MODULES).fill(0);
  for (let i = 0; i < Math.min(weights.length, MAX_MODULES); i += 1) {
    padded[i] = weights[i];
  }
  return padded;
}
