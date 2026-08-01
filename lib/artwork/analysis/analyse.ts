/**
 * Runs every metric over one buffer, in the order their dependencies allow.
 *
 * Pure and DOM-free — `decode.ts` supplies the pixels. Keeping the whole
 * pipeline behind one pure function over a `Uint8ClampedArray` is what makes it
 * testable in the node environment `vitest.config.ts` sets, and it is also the
 * thing that would let this move to a Web Worker later: the boundary would be a
 * `postMessage` of the buffer in and this object out, with nothing else to
 * rearrange.
 *
 * That matters because the whole pass costs roughly 15–20ms at the 256px
 * analysis resolution. It runs once per cover and is cached, but it runs while
 * an episode is starting, so `decode.ts` schedules it off the critical path.
 */

import { extractSwatches, type ArtworkSwatches } from "../palette/swatches";
import { buildFields } from "./fields";
import { buildProtectionMask, MASK_SIZE } from "./mask";
import { analyseEdges, type EdgeMetrics } from "./metrics/edges";
import { analyseMood, type MoodMetrics } from "./metrics/mood";
import { analyseStyle, type StyleMetrics } from "./metrics/style";
import { analyseSubject, type SubjectMetrics } from "./metrics/subject";
import { analyseText, type TextMetrics } from "./metrics/text";
import { analyseTexture, type TextureMetrics } from "./metrics/texture";
import { analyseTone, type ToneMetrics } from "./metrics/tone";

/**
 * Everything a profile scores against.
 *
 * Deliberately free of the large intermediate arrays — the gradient field, the
 * block grids — which exist only long enough to derive the protection mask.
 * What is left is a couple of hundred bytes of plain numbers: small enough to
 * cache, cheap to compare, and readable in a debug overlay without decoding
 * anything.
 */
export type ArtworkFeatures = {
  tone: ToneMetrics;
  edges: Omit<EdgeMetrics, "field">;
  texture: Omit<TextureMetrics, "blocks" | "blockGrid" | "blockSize">;
  text: Omit<TextMetrics, "field" | "grid">;
  subject: SubjectMetrics;
  style: StyleMetrics;
  mood: MoodMetrics;
};

/** The features plus the intermediate fields the mask builder needs. */
export type AnalysisResult = {
  size: number;
  features: ArtworkFeatures;
  /** Gradient magnitude per pixel, 0–1. */
  edgeField: Float32Array;
  /** Per-block text score, at `textGrid` resolution. */
  textField: Float32Array;
  textGrid: number;
};

/**
 * Everything the renderer and the profile selector need from a cover.
 *
 * This is the unit that gets cached. `features` is a couple of hundred bytes of
 * plain numbers, `swatches` a handful of colours, and `mask` a flat 4 KB — the
 * whole thing is small enough to keep for every cover seen in a session without
 * thinking about it.
 */
export type ArtworkAnalysis = {
  /** Resolution the analysis ran at. */
  size: number;
  features: ArtworkFeatures;
  swatches: ArtworkSwatches;
  /** `maskSize²` bytes: 0 free to move, 255 frozen. See `mask.ts`. */
  mask: Uint8Array;
  maskSize: number;
};

/**
 * The whole pipeline, from pixels to something the shader can be built against.
 *
 * The only entry point anything outside this directory should need.
 */
export function analyseArtwork(rgba: Uint8ClampedArray, size?: number): ArtworkAnalysis {
  const result = analysePixels(rgba, size);

  return {
    size: result.size,
    features: result.features,
    swatches: extractSwatches(rgba),
    mask: buildProtectionMask(
      result.edgeField,
      result.size,
      result.textField,
      result.textGrid,
      result.features.subject.protectedRegion,
    ),
    maskSize: MASK_SIZE,
  };
}

export function analysePixels(rgba: Uint8ClampedArray, size?: number): AnalysisResult {
  const fields = buildFields(rgba, size);

  // Order is forced by dependencies, not by preference. Edges come first
  // because three of the five metrics after it read the gradient field, and
  // recomputing it inside each would be the single most expensive mistake
  // available in this file.
  const tone = analyseTone(fields);
  const edges = analyseEdges(fields);
  const texture = analyseTexture(fields);
  const text = analyseText(fields, edges.field);
  const subject = analyseSubject(fields, edges.field, texture);
  const style = analyseStyle(fields, edges.field);
  const mood = analyseMood(tone, edges, texture, style, subject);

  const { field: edgeField, ...edgeFeatures } = edges;
  const { field: textField, grid: textGrid, ...textFeatures } = text;

  // The block grid's dimensions describe how the texture pass was run, not
  // anything about the artwork. Keeping them out means every number in
  // `features` is a 0–1 score, which is what lets the test suite assert that
  // range across the whole object rather than field by field.
  const textureFeatures = { density: texture.density, flatArea: texture.flatArea };

  return {
    size: fields.size,
    features: {
      tone,
      edges: edgeFeatures,
      texture: textureFeatures,
      text: textFeatures,
      subject,
      style,
      mood,
    },
    edgeField,
    textField,
    textGrid,
  };
}
