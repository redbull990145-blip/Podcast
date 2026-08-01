/**
 * Derived per-pixel fields, computed once and shared by every metric.
 *
 * Nine of the metrics in `metrics/` need perceptual luminance, five need HSL
 * saturation and three need hue. Recomputing those inside each metric would
 * mean walking the buffer nine times and doing the same divisions each pass —
 * cheap in isolation, but this runs on the main thread while an episode is
 * starting, which is the exact moment the app can least afford a long task.
 *
 * So the buffer is walked once here and the results handed round as typed
 * arrays. Everything downstream is then a read, not a conversion.
 *
 * Pure and DOM-free on purpose: the decode lives in `decode.ts`, so every
 * metric is testable in the node environment the way `paletteFromPixels`
 * already is.
 */

/**
 * Per-pixel data every metric reads from.
 *
 * All fields are `size * size` long and indexed `y * size + x`, matching the
 * RGBA buffer's own ordering.
 */
export type PixelFields = {
  /** Width and height in pixels. The buffer is always square. */
  size: number;
  /** The original RGBA bytes, kept for metrics that need raw channels. */
  rgba: Uint8ClampedArray;
  /** Perceived brightness, 0–1. Weighted, because green reads far brighter than blue. */
  luma: Float32Array;
  /** HSL saturation, 0 (grey) to 1. */
  sat: Float32Array;
  /** Hue in degrees, 0–360. Zero for achromatic pixels, so always read it with `sat`. */
  hue: Float32Array;
  /**
   * 1 for pixels solid enough to count, 0 for the rest.
   *
   * Transparent artwork is rare but real, and a PNG with a cut-out background
   * would otherwise report itself as very dark and very high-contrast — the
   * transparent region reads as black once the buffer is zero-filled.
   */
  opaque: Uint8Array;
  /** How many pixels `opaque` marks. Metrics divide by this, never by size². */
  opaqueCount: number;
};

/** Perceived brightness, 0–1. Matches the weighting in `lib/player/artwork-palette.ts`. */
export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Below this, a pixel is treated as absent rather than as black.
 *
 * Matches the 125/255 cutoff the palette extractor already uses, so the two
 * modules agree on which pixels exist.
 */
const ALPHA_CUTOFF = 125;

/**
 * Builds every derived field in a single pass.
 *
 * `size` is inferred from the buffer when omitted, which keeps test fixtures
 * from having to state it twice.
 */
export function buildFields(rgba: Uint8ClampedArray, size?: number): PixelFields {
  const count = rgba.length / 4;
  const side = size ?? Math.round(Math.sqrt(count));

  const luma = new Float32Array(count);
  const sat = new Float32Array(count);
  const hue = new Float32Array(count);
  const opaque = new Uint8Array(count);
  let opaqueCount = 0;

  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    if (rgba[i + 3] < ALPHA_CUTOFF) continue;

    opaque[p] = 1;
    opaqueCount += 1;

    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];

    luma[p] = luminance(r, g, b);

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) continue; // achromatic: saturation and hue both stay 0

    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const maxN = max / 255;
    const minN = min / 255;
    const delta = maxN - minN;
    const lightness = (maxN + minN) / 2;

    sat[p] = lightness > 0.5 ? delta / (2 - maxN - minN) : delta / (maxN + minN);

    let h: number;
    if (max === r) h = (gn - bn) / delta + (gn < bn ? 6 : 0);
    else if (max === g) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;

    hue[p] = h * 60;
  }

  return { size: side, rgba, luma, sat, hue, opaque, opaqueCount };
}

// ---------------------------------------------------------------------------
// Shared statistics
// ---------------------------------------------------------------------------

/**
 * Mean of `values` over the pixels `opaque` marks.
 *
 * Returns 0 rather than NaN for a fully transparent buffer — every metric
 * built on this would otherwise propagate NaN into the profile scores, and a
 * NaN score silently loses every comparison instead of failing loudly.
 */
export function maskedMean(values: Float32Array, fields: PixelFields): number {
  if (fields.opaqueCount === 0) return 0;
  let sum = 0;
  for (let p = 0; p < values.length; p += 1) {
    if (fields.opaque[p]) sum += values[p];
  }
  return sum / fields.opaqueCount;
}

/** Population standard deviation over the opaque pixels. */
export function maskedStdDev(
  values: Float32Array,
  fields: PixelFields,
  mean = maskedMean(values, fields),
): number {
  if (fields.opaqueCount === 0) return 0;
  let sum = 0;
  for (let p = 0; p < values.length; p += 1) {
    if (fields.opaque[p]) {
      const d = values[p] - mean;
      sum += d * d;
    }
  }
  return Math.sqrt(sum / fields.opaqueCount);
}

/**
 * The value at a given percentile of the opaque pixels, 0–1.
 *
 * Uses a 256-bin histogram rather than a sort: the inputs here are all
 * normalised 0–1 fields at 128², so a sort would be 16k log 16k comparisons to
 * resolve a number we only need to two decimal places.
 */
export function maskedPercentile(
  values: Float32Array,
  fields: PixelFields,
  percentile: number,
): number {
  if (fields.opaqueCount === 0) return 0;

  const bins = new Int32Array(256);
  for (let p = 0; p < values.length; p += 1) {
    if (!fields.opaque[p]) continue;
    const bin = Math.min(255, Math.max(0, Math.round(values[p] * 255)));
    bins[bin] += 1;
  }

  const target = percentile * fields.opaqueCount;
  let seen = 0;
  for (let bin = 0; bin < 256; bin += 1) {
    seen += bins[bin];
    if (seen >= target) return bin / 255;
  }
  return 1;
}

/** Fraction of opaque pixels for which `predicate` holds, 0–1. */
export function maskedFraction(
  values: Float32Array,
  fields: PixelFields,
  predicate: (value: number) => boolean,
): number {
  if (fields.opaqueCount === 0) return 0;
  let hits = 0;
  for (let p = 0; p < values.length; p += 1) {
    if (fields.opaque[p] && predicate(values[p])) hits += 1;
  }
  return hits / fields.opaqueCount;
}

/** Clamps to 0–1. Used everywhere a raw measurement is turned into a score. */
export function unit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Maps a raw measurement onto 0–1 against a known useful range.
 *
 * Every metric in this directory reports 0–1 so that profile fitness functions
 * can compare them without knowing each one's natural units. `normalise` is
 * where a measurement's real range is written down, once, next to the code
 * that produced it.
 */
export function normalise(value: number, low: number, high: number): number {
  if (high === low) return 0;
  return unit((value - low) / (high - low));
}
