/**
 * Brightness, contrast and colour distribution.
 *
 * These are the cheapest metrics and the ones the most profiles read, because
 * they answer the question that separates the biggest groups of artwork from
 * each other: is this dark or bright, flat or punchy, colourful or muted.
 *
 * Every figure is reported 0–1 against a range chosen from what podcast covers
 * actually contain, not from what the maths could theoretically produce. A raw
 * luminance standard deviation, for instance, tops out around 0.42 on real
 * artwork and effectively never reaches its 0.5 ceiling, so reporting it
 * unscaled would mean every profile's contrast range sat in the bottom half of
 * its nominal span and read as if it had been mistuned.
 */

import {
  maskedFraction,
  maskedMean,
  maskedPercentile,
  maskedStdDev,
  normalise,
  unit,
  type PixelFields,
} from "../fields";

export type ToneMetrics = {
  /** Mean perceived brightness. 0 = black cover, 1 = white cover. */
  brightness: number;
  /** Spread of brightness. Low = flat and even, high = punchy. */
  contrast: number;
  /** How much of the tonal scale is used, from the 5th to the 95th percentile. */
  tonalRange: number;
  /** Fraction of the cover crushed to near-black. */
  shadowClipping: number;
  /** Fraction of the cover blown to near-white. */
  highlightClipping: number;
  /** Mean HSL saturation. */
  saturation: number;
  /**
   * Hasler–Süsstrunk colourfulness, normalised.
   *
   * Distinct from `saturation`: a cover that is uniformly one very saturated
   * red scores high on saturation and low here, because colourfulness measures
   * the *spread* of chroma rather than its magnitude. That difference is what
   * separates a bold single-colour title card from a rich photograph, and the
   * two want different profiles.
   */
  colorfulness: number;
  /**
   * Evenness of the hue distribution, 0–1.
   *
   * High means many hues in comparable amounts; low means one hue family
   * dominates. Saturation-weighted, so the grey pixels that make up most of a
   * muted cover cannot vote for a hue they barely have.
   */
  hueEntropy: number;
  /** Share of the chroma held by the single strongest hue bin. */
  hueConcentration: number;
  /**
   * Centre of the strongest hue bin, in degrees.
   *
   * Only meaningful alongside `hueConcentration` — a cover with its chroma
   * spread evenly has a dominant hue in the arithmetic sense and none in the
   * sense anyone means. Zero for achromatic covers.
   */
  dominantHue: number;
};

/** Bins for the hue histogram. Sixteen gives 22.5° per bin — finer than the eye groups hues. */
const HUE_BINS = 16;

/**
 * Real covers rarely exceed a luminance std-dev of ~0.42, and anything under
 * ~0.04 is a solid colour. Mapping that band onto 0–1 makes `contrast` mean
 * "contrasty for a podcast cover" rather than "contrasty in the abstract".
 */
const CONTRAST_RANGE = [0.04, 0.42] as const;

/** The Hasler–Süsstrunk metric saturates around 110 on 8-bit imagery. */
const COLORFULNESS_CEILING = 110;

/** Below/above these a pixel has lost detail rather than merely being dark or bright. */
const SHADOW_CLIP = 0.03;
const HIGHLIGHT_CLIP = 0.97;

export function analyseTone(fields: PixelFields): ToneMetrics {
  const brightness = maskedMean(fields.luma, fields);
  const rawContrast = maskedStdDev(fields.luma, fields, brightness);

  const p05 = maskedPercentile(fields.luma, fields, 0.05);
  const p95 = maskedPercentile(fields.luma, fields, 0.95);

  return {
    brightness,
    contrast: normalise(rawContrast, CONTRAST_RANGE[0], CONTRAST_RANGE[1]),
    tonalRange: unit(p95 - p05),
    shadowClipping: maskedFraction(fields.luma, fields, (v) => v < SHADOW_CLIP),
    highlightClipping: maskedFraction(fields.luma, fields, (v) => v > HIGHLIGHT_CLIP),
    saturation: maskedMean(fields.sat, fields),
    colorfulness: colorfulness(fields),
    ...hueDistribution(fields),
  };
}

/**
 * Hasler & Süsstrunk's colourfulness metric.
 *
 * Two opponent axes — red-green and yellow-blue — and the metric is the
 * magnitude of their combined spread plus a smaller contribution from their
 * combined offset. It was derived by regressing against human ratings of
 * "colourful", which is precisely the judgement a profile wants to make, and
 * it costs one pass with no colour-space conversion.
 */
function colorfulness(fields: PixelFields): number {
  if (fields.opaqueCount === 0) return 0;

  let sumRg = 0;
  let sumYb = 0;
  let sumRgSq = 0;
  let sumYbSq = 0;

  for (let p = 0, i = 0; p < fields.opaque.length; p += 1, i += 4) {
    if (!fields.opaque[p]) continue;
    const r = fields.rgba[i];
    const g = fields.rgba[i + 1];
    const b = fields.rgba[i + 2];

    const rg = r - g;
    const yb = 0.5 * (r + g) - b;

    sumRg += rg;
    sumYb += yb;
    sumRgSq += rg * rg;
    sumYbSq += yb * yb;
  }

  const n = fields.opaqueCount;
  const meanRg = sumRg / n;
  const meanYb = sumYb / n;
  const varRg = Math.max(0, sumRgSq / n - meanRg * meanRg);
  const varYb = Math.max(0, sumYbSq / n - meanYb * meanYb);

  const spread = Math.sqrt(varRg + varYb);
  const offset = Math.sqrt(meanRg * meanRg + meanYb * meanYb);

  return unit((spread + 0.3 * offset) / COLORFULNESS_CEILING);
}

/**
 * Hue spread, weighted by saturation.
 *
 * The weighting is the whole point. An unweighted hue histogram over a muted
 * photograph is dominated by near-grey pixels whose hue is numerically real but
 * perceptually meaningless — the resulting entropy says "many hues" about a
 * cover a person would call beige. Weighting by saturation means a pixel votes
 * in proportion to how much hue it actually has.
 */
function hueDistribution(fields: PixelFields): {
  hueEntropy: number;
  hueConcentration: number;
  dominantHue: number;
} {
  const bins = new Float64Array(HUE_BINS);
  let total = 0;

  for (let p = 0; p < fields.hue.length; p += 1) {
    if (!fields.opaque[p]) continue;
    const weight = fields.sat[p];
    if (weight <= 0) continue;

    const bin = Math.min(HUE_BINS - 1, Math.floor((fields.hue[p] / 360) * HUE_BINS));
    bins[bin] += weight;
    total += weight;
  }

  // A cover with no chroma at all has no hue distribution to describe. Zero on
  // both counts is the honest answer, and it routes such covers toward the
  // luminance-only profiles, which is where they belong anyway.
  if (total === 0) return { hueEntropy: 0, hueConcentration: 0, dominantHue: 0 };

  let entropy = 0;
  let peak = 0;
  let peakBin = 0;
  for (let bin = 0; bin < HUE_BINS; bin += 1) {
    if (bins[bin] <= 0) continue;
    const share = bins[bin] / total;
    entropy -= share * Math.log2(share);
    if (share > peak) {
      peak = share;
      peakBin = bin;
    }
  }

  return {
    dominantHue: ((peakBin + 0.5) / HUE_BINS) * 360,
    // Divided by the maximum possible entropy for this bin count, so the figure
    // is "how even is this" rather than "how many bins did we use".
    hueEntropy: unit(entropy / Math.log2(HUE_BINS)),
    hueConcentration: unit(peak),
  };
}
