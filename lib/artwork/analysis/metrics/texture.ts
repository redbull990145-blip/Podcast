/**
 * Texture density and negative space, measured as local variance.
 *
 * Sobel in `edges.ts` answers "where are the boundaries"; this answers "where
 * is the surface busy". They diverge on exactly the cases that matter here.
 * Film grain, fabric, foliage and paper texture have enormous local variance
 * and almost no coherent edges — a gradient detector calls them empty. A large
 * flat shape bounded by one crisp outline is the reverse: one strong edge, no
 * variance at all.
 *
 * The engine needs both because they route to opposite profiles. High variance
 * with low edge density is what Soft Texture Movement exists for. Low variance
 * with low edge density is negative space, and negative space is where a light
 * field can drift widely without ever coming near anything a person is reading.
 */

import { normalise, unit, type PixelFields } from "../fields";

export type TextureMetrics = {
  /** Mean local variance across the cover, normalised. */
  density: number;
  /**
   * Fraction of the cover that is essentially featureless.
   *
   * This is the negative-space figure. It is deliberately measured on variance
   * rather than on brightness: a large area of flat mid-grey is negative space,
   * and a brightness-based test would call it "occupied" simply for not being
   * white.
   */
  flatArea: number;
  /** Per-block variance, 0–1, at `size / blockSize` resolution. Reused by `subject.ts`. */
  blocks: Float32Array;
  /** Side length of the block grid. */
  blockGrid: number;
  /** Pixels per block along each axis. */
  blockSize: number;
};

/**
 * 4×4 blocks.
 *
 * At the 128px analysis resolution that is a 32×32 grid — fine enough to
 * separate a subject from its background, coarse enough that a single noisy
 * pixel cannot create a hotspot. Larger blocks start averaging a subject
 * together with the space around it, which is the failure that would make
 * `flatArea` meaningless.
 */
const BLOCK_SIZE = 4;

/**
 * A block whose luminance standard deviation is below this reads as flat to the
 * eye. About 1.3 levels out of 255 — under the threshold at which 8-bit banding
 * itself becomes visible, so anything quieter genuinely has nothing in it.
 */
const FLAT_THRESHOLD = 0.005;

/**
 * Block standard deviation is normalised against 0.25 rather than its 0.5
 * theoretical maximum: a 4×4 block averaging half black and half white sits at
 * 0.5, and nothing short of a checkerboard of pure extremes gets near it.
 */
const VARIANCE_CEILING = 0.25;

/**
 * Mean block standard deviation, in luminance units.
 *
 * Much lower than it looks like it should be. Fine sensor grain sits around
 * 0.05 and heavy texture — foliage, fabric, halftone — around 0.10; a block
 * reaching 0.28 would have to be alternating black and white, which nothing
 * photographic does. A ceiling set where the maths tops out rather than where
 * real covers do would report every photograph as smooth.
 */
const DENSITY_RANGE = [0.005, 0.12] as const;

export function analyseTexture(fields: PixelFields): TextureMetrics {
  const { size, luma, opaque } = fields;
  const grid = Math.ceil(size / BLOCK_SIZE);
  const blocks = new Float32Array(grid * grid);

  let sum = 0;
  let flat = 0;

  for (let by = 0; by < grid; by += 1) {
    for (let bx = 0; bx < grid; bx += 1) {
      let n = 0;
      let total = 0;
      let totalSq = 0;

      const yEnd = Math.min(size, (by + 1) * BLOCK_SIZE);
      const xEnd = Math.min(size, (bx + 1) * BLOCK_SIZE);

      for (let y = by * BLOCK_SIZE; y < yEnd; y += 1) {
        for (let x = bx * BLOCK_SIZE; x < xEnd; x += 1) {
          const p = y * size + x;
          if (!opaque[p]) continue;
          n += 1;
          total += luma[p];
          totalSq += luma[p] * luma[p];
        }
      }

      // A block that is entirely transparent is not flat, it is absent. Leaving
      // it at zero would let a cut-out PNG inflate `flatArea` with area that is
      // not part of the artwork at all.
      if (n === 0) continue;

      const mean = total / n;
      const stdDev = Math.sqrt(Math.max(0, totalSq / n - mean * mean));

      blocks[by * grid + bx] = unit(stdDev / VARIANCE_CEILING);
      sum += stdDev;
      if (stdDev < FLAT_THRESHOLD) flat += 1;
    }
  }

  const blockCount = grid * grid;

  return {
    density: normalise(sum / blockCount, DENSITY_RANGE[0], DENSITY_RANGE[1]),
    flatArea: flat / blockCount,
    blocks,
    blockGrid: grid,
    blockSize: BLOCK_SIZE,
  };
}
