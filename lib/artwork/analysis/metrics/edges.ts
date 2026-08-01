/**
 * Edge detection — the backbone of the whole engine.
 *
 * The gradient field this produces is used three times over: it tells the
 * profile selector how busy a cover is, it feeds the illustration-versus-
 * photograph test, and most importantly it becomes the protection mask that
 * stops any part of the shader from displacing text or a logo.
 *
 * That third use is why this runs on every cover rather than only on the ones a
 * profile asks about. Text is, by construction, the highest-gradient region of
 * a podcast cover — a glyph is a maximally sharp light/dark boundary repeated
 * every few pixels — so a plain Sobel identifies typography without needing to
 * know what typography is. The protection mask never has to trust the text
 * classifier in `text.ts` to be correct, which is what makes a misclassification
 * cost nothing.
 */

import { normalise, unit, type PixelFields } from "../fields";

export type EdgeMetrics = {
  /** Fraction of the cover sitting on a strong gradient. */
  density: number;
  /** Mean gradient magnitude, normalised. Busy-ness including the soft edges. */
  meanMagnitude: number;
  /**
   * Which way the structure runs, −1 to +1.
   *
   * Positive means gradients point mostly up/down, which happens when the
   * *content* is banded left-to-right — a horizon, a skyline, a strip of colour.
   * Negative means vertical structure. Near zero means no preferred direction,
   * which is what portraits, logos and most illustration produce.
   */
  horizontalBanding: number;
  /** Gradient magnitude per pixel, 0–1. Reused by `mask.ts` and `style.ts`. */
  field: Float32Array;
};

/**
 * Above this normalised magnitude a pixel counts as "on an edge".
 *
 * Set from the gap between the two populations rather than picked round: on
 * real covers the gradient histogram is strongly bimodal, with a dense noise
 * floor below ~0.1 and genuine boundaries above ~0.25. Anything in between is
 * ambiguous, so the threshold sits at the top of the ambiguous band where it
 * cannot be moved a little and change the answer a lot.
 */
const EDGE_THRESHOLD = 0.25;

/**
 * A Sobel response of 4 (out of a theoretical 4·√2) is already a hard
 * black-to-white boundary, so magnitudes are normalised against that rather
 * than against the theoretical maximum, which nothing real ever approaches.
 */
const MAGNITUDE_CEILING = 4;

/** Real covers run from about 0.02 (a plain gradient) to 0.35 (dense type). */
const DENSITY_RANGE = [0.02, 0.35] as const;

/**
 * 3×3 Sobel over the luminance field, with edge pixels clamped to the border.
 *
 * Clamping rather than skipping matters for the mask: a cover whose title runs
 * to the very edge of the frame would otherwise leave that text unprotected in
 * the outermost row, which is exactly where a drifting light field is most
 * likely to be displacing something.
 */
export function analyseEdges(fields: PixelFields): EdgeMetrics {
  const { size, luma } = fields;
  const field = new Float32Array(size * size);

  let sumMagnitude = 0;
  let sumAbsGx = 0;
  let sumAbsGy = 0;
  let strong = 0;

  const at = (x: number, y: number) => {
    const cx = x < 0 ? 0 : x >= size ? size - 1 : x;
    const cy = y < 0 ? 0 : y >= size ? size - 1 : y;
    return luma[cy * size + cx];
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const tl = at(x - 1, y - 1);
      const tc = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const ml = at(x - 1, y);
      const mr = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const bc = at(x, y + 1);
      const br = at(x + 1, y + 1);

      const gx = tl + 2 * ml + bl - (tr + 2 * mr + br);
      const gy = tl + 2 * tc + tr - (bl + 2 * bc + br);

      const magnitude = unit(Math.sqrt(gx * gx + gy * gy) / MAGNITUDE_CEILING);

      field[y * size + x] = magnitude;
      sumMagnitude += magnitude;
      sumAbsGx += Math.abs(gx);
      sumAbsGy += Math.abs(gy);
      if (magnitude >= EDGE_THRESHOLD) strong += 1;
    }
  }

  const pixels = size * size;
  const orientationTotal = sumAbsGx + sumAbsGy;

  return {
    density: normalise(strong / pixels, DENSITY_RANGE[0], DENSITY_RANGE[1]),
    meanMagnitude: unit(sumMagnitude / pixels),
    horizontalBanding: orientationTotal === 0 ? 0 : (sumAbsGy - sumAbsGx) / orientationTotal,
    field,
  };
}
