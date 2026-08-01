/**
 * Text likelihood.
 *
 * "Text-heavy artwork should barely animate" needs a number to act on, and
 * there is no OCR here — this is a signature detector, not a reader. It looks
 * for the three things that co-occur in typography and essentially never
 * co-occur anywhere else:
 *
 *   1. **Bimodality.** A block of text is ink on a background: two luminance
 *      populations with almost nothing between them. Otsu's method finds the
 *      split, and its separability score says how cleanly the block divides.
 *      Photographs are continuous-tone and score low almost everywhere.
 *
 *   2. **Horizontal transitions, but not too many.** Scanning across a line of
 *      type crosses the threshold repeatedly — into a stroke, out of it, into
 *      the next. A single hard boundary, which is what a logo edge or the side
 *      of a building produces, crosses exactly once. But a crossing on every
 *      other pixel is noise rather than glyphs, so this is a band with a
 *      falling edge, not a ramp.
 *
 *   3. **Vertical coherence.** A stroke persists down the height of a glyph, so
 *      one row of a text block looks almost exactly like the row beneath it.
 *      This is the term that rejects film grain and dense foliage, and without
 *      it the detector is actively wrong: random noise is *more* bimodal and
 *      *more* busy than type, and scores higher on the first two tests than
 *      real text does. Structure over the vertical is what type has and noise
 *      does not.
 *
 *   4. **Sharp gradients.** Rendered type is antialiased but never soft.
 *
 * The four are multiplied rather than averaged, so a block has to satisfy all
 * of them. That biases the detector toward false negatives, which is the right
 * direction: a missed block of text still gets full protection from the edge
 * mask in `mask.ts`, which is computed from raw gradients and does not consult
 * this file at all. This metric only decides how *calm* the animation should
 * be. It is never the thing standing between a shader and a glyph.
 */

import { normalise, unit, type PixelFields } from "../fields";

export type TextMetrics = {
  /**
   * Fraction of the cover that looks like typography, 0–1.
   *
   * Above ~0.55 the selector forces the Quiet Luminance profile.
   */
  amount: number;
  /** Per-block score, 0–1, at `size / BLOCK` resolution. Folded into the protection mask. */
  field: Float32Array;
  /** Side length of the block grid. */
  grid: number;
};

/**
 * Two block sizes, and the reason there are two.
 *
 * The detector counts threshold crossings across a block, so the block has to
 * be wide enough to contain more than one stroke. 8px at the 256px analysis
 * resolution is right for body-sized type, where the letter period is 5–8px.
 *
 * It is badly wrong for large display type, which is what podcast covers
 * actually put their titles in. A 30px-tall headline has a letter period around
 * 14px, so an 8px window frequently spans a single stroke and counts one
 * crossing — indistinguishable, to this metric, from a plain edge. Verified
 * against a real cover whose title fills a third of the frame: at 8px alone the
 * whole thing scored 1%.
 *
 * Scanning at 16px as well and taking whichever scale found more catches both.
 * The cost is one extra pass over a quarter as many blocks.
 */
const BLOCKS = [8, 16] as const;

/** Bins for the per-block Otsu histogram. 32 is ample for 64 samples. */
const BINS = 32;

/**
 * Crossings per row.
 *
 * Rises from 1.2 — one crossing is a boundary, not a glyph — and falls again
 * past 4.5, where a "stroke" would be barely a pixel wide and the block is
 * noise rather than type. Two to four crossings across eight pixels is what
 * words look like at this resolution.
 */
const TRANSITION_RISE = [1.2, 2.2] as const;
const TRANSITION_FALL = [4.5, 6.5] as const;

/**
 * How alike two vertically adjacent rows must be.
 *
 * Uncorrelated rows agree half the time by chance, so 0.6 is the floor of
 * "better than nothing"; a glyph's rows agree well past 0.9.
 */
const COHERENCE_RANGE = [0.62, 0.9] as const;

/** A block below this normalised gradient is too soft to be rendered type. */
const SHARPNESS_RANGE = [0.06, 0.28] as const;

/** Above this a block counts toward `amount`. */
const BLOCK_THRESHOLD = 0.22;

export function analyseText(fields: PixelFields, edgeField: Float32Array): TextMetrics {
  const scales = BLOCKS.map((block) => scan(fields, edgeField, block));

  // The finest grid is the output resolution; coarser scales are upsampled onto
  // it. Taking the maximum means a region counts as type if *either* scale
  // recognised it, which is the point of having two.
  const [finest, ...rest] = scales;
  const grid = finest.grid;
  const field = finest.field;

  for (const coarse of rest) {
    const ratio = coarse.grid / grid;
    for (let y = 0; y < grid; y += 1) {
      const cy = Math.min(coarse.grid - 1, Math.floor(y * ratio));
      for (let x = 0; x < grid; x += 1) {
        const cx = Math.min(coarse.grid - 1, Math.floor(x * ratio));
        const i = y * grid + x;
        field[i] = Math.max(field[i], coarse.field[cy * coarse.grid + cx]);
      }
    }
  }

  let hits = 0;
  for (const value of field) {
    if (value > BLOCK_THRESHOLD) hits += 1;
  }

  return { amount: hits / field.length, field, grid };
}

/** Scores every block at one scale. */
function scan(
  fields: PixelFields,
  edgeField: Float32Array,
  block: number,
): { field: Float32Array; grid: number } {
  const { size, luma, opaque } = fields;
  const grid = Math.ceil(size / block);
  const raw = new Float32Array(grid * grid);

  const histogram = new Float64Array(BINS);

  for (let by = 0; by < grid; by += 1) {
    for (let bx = 0; bx < grid; bx += 1) {
      const yEnd = Math.min(size, (by + 1) * block);
      const xEnd = Math.min(size, (bx + 1) * block);
      const y0 = by * block;
      const x0 = bx * block;

      histogram.fill(0);
      let n = 0;
      let edgeSum = 0;

      for (let y = y0; y < yEnd; y += 1) {
        for (let x = x0; x < xEnd; x += 1) {
          const p = y * size + x;
          if (!opaque[p]) continue;
          histogram[Math.min(BINS - 1, Math.floor(luma[p] * BINS))] += 1;
          edgeSum += edgeField[p];
          n += 1;
        }
      }

      // Too little of the block is present to say anything about it.
      if (n < block * 2) continue;

      const otsu = separate(histogram, n);
      if (otsu === null) continue;

      const { crossings, agreement } = rowStructure(
        fields,
        x0,
        y0,
        xEnd,
        yEnd,
        otsu.threshold,
      );

      const transitions =
        normalise(crossings, TRANSITION_RISE[0], TRANSITION_RISE[1]) *
        (1 - normalise(crossings, TRANSITION_FALL[0], TRANSITION_FALL[1]));

      raw[by * grid + bx] =
        otsu.separability *
        transitions *
        normalise(agreement, COHERENCE_RANGE[0], COHERENCE_RANGE[1]) *
        normalise(edgeSum / n, SHARPNESS_RANGE[0], SHARPNESS_RANGE[1]);
    }
  }

  return { field: cohere(raw, grid), grid };
}

/**
 * Otsu's threshold and how cleanly it separates the block.
 *
 * Separability is the between-class variance over the total variance: 1 means
 * two perfectly distinct populations, 0 means one continuous one. Returns null
 * for a block with no variance at all, where there is nothing to threshold and
 * the ratio would be 0/0.
 */
function separate(
  histogram: Float64Array,
  n: number,
): { threshold: number; separability: number } | null {
  let total = 0;
  for (let bin = 0; bin < BINS; bin += 1) total += bin * histogram[bin];

  const mean = total / n;

  let totalVariance = 0;
  for (let bin = 0; bin < BINS; bin += 1) {
    const d = bin - mean;
    totalVariance += histogram[bin] * d * d;
  }
  totalVariance /= n;
  if (totalVariance <= 0) return null;

  let weightBelow = 0;
  let sumBelow = 0;
  let best = -1;
  let bestBin = 0;

  for (let bin = 0; bin < BINS - 1; bin += 1) {
    weightBelow += histogram[bin];
    if (weightBelow === 0) continue;

    const weightAbove = n - weightBelow;
    if (weightAbove === 0) break;

    sumBelow += bin * histogram[bin];

    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (total - sumBelow) / weightAbove;
    const delta = meanBelow - meanAbove;
    const between = (weightBelow * weightAbove * delta * delta) / (n * n);

    if (between > best) {
      best = between;
      bestBin = bin;
    }
  }

  return {
    // Back to 0–1 luminance, at the top of the winning bin — the split sits
    // between the two populations rather than inside the darker one.
    threshold: (bestBin + 1) / BINS,
    separability: unit(best / totalVariance),
  };
}

/**
 * How often a row crosses the threshold, and how much each row looks like the
 * one below it.
 *
 * Both come from the same thresholded rows, so they are measured together
 * rather than in two passes over the same pixels.
 */
function rowStructure(
  fields: PixelFields,
  x0: number,
  y0: number,
  xEnd: number,
  yEnd: number,
  threshold: number,
): { crossings: number; agreement: number } {
  const { size, luma, opaque } = fields;
  const width = xEnd - x0;

  let crossings = 0;
  let rows = 0;
  let agreements = 0;
  let comparisons = 0;

  // Two buffers, alternated by the count of rows actually kept rather than by
  // `y`, so a skipped transparent row does not shift the parity and make the
  // next comparison run against the row before last.
  const buffers = [new Uint8Array(width), new Uint8Array(width)];

  for (let y = y0; y < yEnd; y += 1) {
    const row = buffers[rows & 1];
    const previousRow = rows > 0 ? buffers[(rows - 1) & 1] : null;
    let present = 0;

    for (let x = x0; x < xEnd; x += 1) {
      const p = y * size + x;
      // Transparent pixels take the value of whatever preceded them rather than
      // a third state, so a cut-out edge running through a block cannot invent
      // crossings that are really just the hole.
      row[x - x0] = opaque[p] ? (luma[p] > threshold ? 1 : 0) : x > x0 ? row[x - x0 - 1] : 0;
      if (opaque[p]) present += 1;
    }

    if (present === 0) continue;

    for (let i = 1; i < width; i += 1) {
      if (row[i] !== row[i - 1]) crossings += 1;
    }

    if (previousRow) {
      for (let i = 0; i < width; i += 1) {
        if (row[i] === previousRow[i]) agreements += 1;
      }
      comparisons += width;
    }

    // Rows that never cross still count toward the divisor — the space between
    // two lines of type is exactly that, and excluding it would make a
    // well-leaded paragraph score like a solid block of ink.
    rows += 1;
  }

  return {
    crossings: rows === 0 ? 0 : crossings / rows,
    // A single-row block has nothing to compare against. Treating that as
    // maximally coherent would let an isolated row of noise through, so it
    // scores as chance.
    agreement: comparisons === 0 ? 0.5 : agreements / comparisons,
  };
}

/**
 * Requires a block's neighbours to agree with it.
 *
 * Type comes in runs. An isolated 8px block that happens to be bimodal and busy
 * is a highlight on a rim, a window in a building, or noise — not a word. Text
 * has text beside it, so a block's score is scaled by the best of its left and
 * right neighbours.
 *
 * Horizontal neighbours only: a heading with generous leading has blank blocks
 * above and below it, and demanding vertical agreement would erase precisely
 * the large display type this metric most needs to catch.
 */
function cohere(raw: Float32Array, grid: number): Float32Array {
  const field = new Float32Array(raw.length);

  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      const i = y * grid + x;
      const left = x > 0 ? raw[i - 1] : 0;
      const right = x < grid - 1 ? raw[i + 1] : 0;

      field[i] = raw[i] * (0.5 + 0.5 * Math.max(left, right));
    }
  }

  return field;
}
