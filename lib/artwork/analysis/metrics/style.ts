/**
 * Illustration versus photograph.
 *
 * This is the cleanest separator in the whole analysis, and it rests on one
 * fact: **a photograph has a noise floor and vector art does not.**
 *
 * Every digital photograph, however well lit and however heavily denoised,
 * carries sensor noise and JPEG ringing. Two adjacent pixels in a "flat" sky
 * differ by a level or two. Illustration, vector art, a title card, a gradient
 * exported from a design tool — these contain genuinely identical neighbouring
 * pixels across large areas, because nothing physical produced them.
 *
 * So: quantise to 5 bits and count the pixels whose entire 3×3 neighbourhood is
 * *exactly* uniform. Photographs score near zero on this and illustrations score
 * high, with almost nothing in between. It is far more reliable than the usual
 * proxies (colour count, edge sharpness, saturation), all of which have wide
 * overlapping distributions.
 *
 * Quantising to 5 bits rather than testing raw equality is what makes it robust
 * to the artwork having been through a lossy re-encode on its way out of the
 * publisher's CMS — a re-encoded flat region stays flat at 5 bits, while
 * genuine photographic noise still crosses bin boundaries.
 */

import { normalise, unit, type PixelFields } from "../fields";

export type StyleMetrics = {
  /** Likelihood the cover was drawn or designed rather than photographed, 0–1. */
  illustrationScore: number;
  /** Fraction of the cover made of exactly-uniform neighbourhoods. */
  plateauArea: number;
  /** Occupied 5-bit colour bins, normalised. Low means a designed, limited palette. */
  paletteBreadth: number;
  /**
   * How cleanly gradients divide into "flat" and "hard", 0–1.
   *
   * Vector art is mostly one or the other with little between. Photographs fill
   * the middle. A secondary signal, weighted lightly — it disagrees with the
   * plateau test on airbrushed and painterly illustration, which is the one
   * place the plateau test is genuinely uncertain too.
   */
  edgeBimodality: number;
};

/** 5 bits per channel — 32 levels, 32768 possible bins. */
const LEVELS = 32;

/** Real covers: a photograph lands near 0.02, flat vector art past 0.55. */
const PLATEAU_RANGE = [0.03, 0.5] as const;

/**
 * Occupied bins as a share of the pixel count.
 *
 * The range is much lower than intuition suggests. A 256² photograph holds
 * 65k pixels but only a few thousand distinct 5-bit colours, because natural
 * images cluster tightly in colour space — so a real photograph lands around
 * 0.04, not near 1. Vector art with a designed palette lands three orders of
 * magnitude below that.
 */
const BREADTH_RANGE = [0.002, 0.08] as const;

/** Gradients between these are neither flat nor a hard boundary. */
const MID_BAND = [0.08, 0.3] as const;

export function analyseStyle(fields: PixelFields, edgeField: Float32Array): StyleMetrics {
  const { size, rgba, opaque } = fields;

  const quantised = new Int32Array(size * size);
  const occupied = new Set<number>();

  for (let p = 0, i = 0; p < opaque.length; p += 1, i += 4) {
    if (!opaque[p]) {
      quantised[p] = -1;
      continue;
    }
    const bin =
      ((rgba[i] * LEVELS) >> 8) * LEVELS * LEVELS +
      ((rgba[i + 1] * LEVELS) >> 8) * LEVELS +
      ((rgba[i + 2] * LEVELS) >> 8);
    quantised[p] = bin;
    occupied.add(bin);
  }

  let plateau = 0;
  let counted = 0;

  // The border is skipped rather than clamped. Clamping would compare a pixel
  // with a duplicate of itself and report uniformity that is an artefact of the
  // clamp — the opposite of the mistake `edges.ts` avoids by clamping, because
  // there the concern is missing a real feature and here it is inventing one.
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const p = y * size + x;
      const bin = quantised[p];
      if (bin < 0) continue;

      counted += 1;

      if (
        quantised[p - size - 1] === bin &&
        quantised[p - size] === bin &&
        quantised[p - size + 1] === bin &&
        quantised[p - 1] === bin &&
        quantised[p + 1] === bin &&
        quantised[p + size - 1] === bin &&
        quantised[p + size] === bin &&
        quantised[p + size + 1] === bin
      ) {
        plateau += 1;
      }
    }
  }

  const plateauArea = counted === 0 ? 0 : plateau / counted;
  const paletteBreadth =
    fields.opaqueCount === 0 ? 0 : occupied.size / fields.opaqueCount;

  let middling = 0;
  for (let p = 0; p < edgeField.length; p += 1) {
    if (!opaque[p]) continue;
    if (edgeField[p] > MID_BAND[0] && edgeField[p] < MID_BAND[1]) middling += 1;
  }
  const edgeBimodality =
    fields.opaqueCount === 0 ? 0 : unit(1 - (middling / fields.opaqueCount) / 0.35);

  const plateauEvidence = normalise(plateauArea, PLATEAU_RANGE[0], PLATEAU_RANGE[1]);
  const breadthEvidence = 1 - normalise(paletteBreadth, BREADTH_RANGE[0], BREADTH_RANGE[1]);

  return {
    plateauArea,
    paletteBreadth: normalise(paletteBreadth, BREADTH_RANGE[0], BREADTH_RANGE[1]),
    edgeBimodality,
    // Weighted toward the plateau test because it is the one with separated
    // distributions; the other two break ties on painterly work where the
    // plateau test genuinely sits in the middle.
    illustrationScore: unit(
      plateauEvidence * 0.6 + breadthEvidence * 0.25 + edgeBimodality * 0.15,
    ),
  };
}
