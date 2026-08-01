/**
 * Where the subject is, and what kind of subject it is.
 *
 * Composition decides where an animation is allowed to be generous. A cover
 * with its subject tight in the centre and clean space around it can carry a
 * wide, slow light field in that space; a cover with detail edge to edge
 * cannot, because there is nowhere for the light to go that is not already
 * occupied by something a person is looking at.
 *
 * Portrait detection is here for the opposite reason to the one it usually
 * serves. Nothing in this engine is ever going to animate a face — no morphing,
 * no blinking, no mouths, as a matter of what the shader is capable of rather
 * than what it chooses. Finding faces is how the engine knows to hold *more*
 * still: the detected region is painted into the protection mask at full
 * strength, so every displacing term is multiplied to zero across it, and the
 * cover is routed to a profile that only touches luminance anyway.
 *
 * That double use is what makes the weakness of the detector acceptable. See
 * `skinMass` for what it actually measures and where it is wrong.
 */

import { normalise, unit, type PixelFields } from "../fields";
import type { TextureMetrics } from "./texture";

/** Coarse position of the subject, for profiles that place a light source relative to it. */
export type SubjectZone =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type SubjectMetrics = {
  /** Saliency-weighted centre of the cover, each axis 0–1. */
  centroid: { x: number; y: number };
  /** `centroid` snapped to a 3×3 grid. */
  zone: SubjectZone;
  /** 0 = weight spread evenly across the quadrants, 1 = all of it in one. */
  balance: number;
  /** Fraction of the cover carrying no detail. Taken from the texture pass. */
  negativeSpace: number;
  /** Share of the cover's detail sitting in the middle half of the frame. */
  centerMass: number;
  /** Likelihood the cover is built around a person, 0–1. */
  portraitScore: number;
  /** Likelihood the cover is a wide banded scene, 0–1. */
  landscapeScore: number;
  /**
   * The region to freeze completely, in normalised coordinates, or null.
   *
   * Written straight into the protection mask. `radius` is deliberately
   * generous — it covers the skin mass plus a margin, because the hair and
   * shoulder edges around a face matter as much as the face.
   */
  protectedRegion: { x: number; y: number; radius: number } | null;
};

/**
 * The classic YCbCr skin gamut.
 *
 * Chroma-only, which is the reason to use it: skin varies enormously in
 * luminance across people and lighting but occupies a comparatively tight and
 * tone-independent band in Cb/Cr. The `Y` floor exists only to drop pixels so
 * dark that their chroma is quantisation noise.
 *
 * Its well-known weakness is that wood, sand, terracotta and a lot of warm
 * beige fall inside the same band. `skinMass` compensates by requiring the
 * matching pixels to be *compact* rather than merely present — a beige
 * background covers the frame, a face does not.
 */
const SKIN = { minCb: 77, maxCb: 127, minCr: 133, maxCr: 173, minY: 30 } as const;

/** Below this share of the frame there is no subject; above it, it is a backdrop. */
const SKIN_AREA_RANGE = [0.02, 0.45] as const;

function isSkin(r: number, g: number, b: number): boolean {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < SKIN.minY) return false;

  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  if (cb < SKIN.minCb || cb > SKIN.maxCb) return false;

  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cr >= SKIN.minCr && cr <= SKIN.maxCr;
}

export function analyseSubject(
  fields: PixelFields,
  edgeField: Float32Array,
  texture: TextureMetrics,
): SubjectMetrics {
  const { centroid, centerMass, balance } = distribution(fields, edgeField);
  const skin = skinMass(fields);
  const banding = rowCoherence(fields);

  return {
    centroid,
    zone: zoneOf(centroid),
    balance,
    negativeSpace: texture.flatArea,
    centerMass,
    portraitScore: skin.score,
    /*
     * Banding, minus anything that looks like a person.
     *
     * The obvious second term is "and no subject in the middle", but that is
     * wrong on the most ordinary landscape there is: a horizon usually sits
     * near the vertical centre, so a centre-weighted penalty punishes exactly
     * the covers this is meant to find. A face is the thing that actually rules
     * a landscape out, and it already has a detector.
     */
    landscapeScore: unit(banding * (1 - skin.score)),
    protectedRegion: skin.region,
  };
}

/**
 * Saliency-weighted centroid, central mass and quadrant balance.
 *
 * Saliency here is gradient magnitude. That is a crude model of attention, but
 * it is the correct crude model for this purpose: the engine is not trying to
 * find what a person finds interesting, it is trying to find what has detail in
 * it, because detail is what an animation can damage.
 */
function distribution(
  fields: PixelFields,
  edgeField: Float32Array,
): {
  centroid: { x: number; y: number };
  centerMass: number;
  balance: number;
} {
  const { size, opaque } = fields;

  let total = 0;
  let sumX = 0;
  let sumY = 0;
  let centre = 0;
  const quadrants = [0, 0, 0, 0];

  const low = size * 0.25;
  const high = size * 0.75;
  const half = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const p = y * size + x;
      if (!opaque[p]) continue;

      const weight = edgeField[p];
      if (weight <= 0) continue;

      total += weight;
      sumX += x * weight;
      sumY += y * weight;

      if (x >= low && x < high && y >= low && y < high) centre += weight;
      quadrants[(y < half ? 0 : 2) + (x < half ? 0 : 1)] += weight;
    }
  }

  // A cover with no gradient anywhere — a single flat colour — has no subject.
  // Reporting the geometric centre is the honest answer and keeps every
  // downstream division defined.
  if (total === 0) {
    return { centroid: { x: 0.5, y: 0.5 }, centerMass: 0, balance: 0 };
  }

  let spread = 0;
  for (const q of quadrants) {
    const share = q / total - 0.25;
    spread += share * share;
  }

  return {
    centroid: { x: sumX / total / size, y: sumY / total / size },
    centerMass: centre / total,
    // 0.75 is the value `spread` takes when one quadrant holds everything, so
    // dividing by it puts a fully lopsided cover at exactly 1.
    balance: unit(Math.sqrt(spread / 0.75)),
  };
}

function zoneOf({ x, y }: { x: number; y: number }): SubjectZone {
  const col = x < 0.38 ? "left" : x > 0.62 ? "right" : "center";
  const row = y < 0.38 ? "top" : y > 0.62 ? "bottom" : "center";

  if (row === "center" && col === "center") return "center";
  if (row === "center") return col as SubjectZone;
  if (col === "center") return row as SubjectZone;
  return `${row}-${col}` as SubjectZone;
}

/**
 * Finds a compact mass of skin-toned pixels.
 *
 * Compactness is what makes this usable rather than a warm-colour detector. The
 * score is the product of two terms: how plausible the area is for a subject,
 * and how tightly the matching pixels cluster. A terracotta background matches
 * on colour and fails on both — it covers too much of the frame and its spread
 * is the whole frame.
 */
function skinMass(fields: PixelFields): {
  score: number;
  region: { x: number; y: number; radius: number } | null;
} {
  const { size, rgba, opaque } = fields;

  // Marked in a pass rather than re-tested, because the spread below needs the
  // same predicate against a centroid the first pass has not produced yet.
  const skin = new Uint8Array(opaque.length);
  let matched = 0;
  let sumX = 0;
  let sumY = 0;

  for (let p = 0, i = 0; p < opaque.length; p += 1, i += 4) {
    if (!opaque[p] || !isSkin(rgba[i], rgba[i + 1], rgba[i + 2])) continue;

    skin[p] = 1;
    matched += 1;
    sumX += p % size;
    sumY += Math.floor(p / size);
  }

  if (matched === 0 || fields.opaqueCount === 0) return { score: 0, region: null };

  const area = matched / fields.opaqueCount;
  const cx = sumX / matched;
  const cy = sumY / matched;

  let spreadX = 0;
  let spreadY = 0;
  for (let p = 0; p < skin.length; p += 1) {
    if (!skin[p]) continue;
    const dx = (p % size) - cx;
    const dy = Math.floor(p / size) - cy;
    spreadX += dx * dx;
    spreadY += dy * dy;
  }

  const sigmaX = Math.sqrt(spreadX / matched) / size;
  const sigmaY = Math.sqrt(spreadY / matched) / size;
  const sigma = Math.sqrt((spreadX + spreadY) / matched) / size;

  // Plausible area, peaking in the middle of the band and falling off at both
  // ends: too little is a stray warm highlight, too much is a background.
  const areaScore =
    area < SKIN_AREA_RANGE[0]
      ? 0
      : area > SKIN_AREA_RANGE[1]
        ? 0
        : 1 - Math.abs(area - 0.16) / 0.29;

  // A face plus neck and hands sits around σ = 0.12–0.22 of the frame. Anything
  // past 0.35 is scattered across the cover and is not one subject.
  const compactness = 1 - normalise(sigma, 0.18, 0.4);

  /*
   * How square the mass is.
   *
   * This is what stops the detector calling a sunlit horizon a person. Sand,
   * terracotta and warm stone all sit inside the skin gamut, and a band of them
   * across the frame passes both the area and the compactness tests — its
   * radial spread is unremarkable because a huge horizontal spread averages
   * with a tiny vertical one.
   *
   * Measuring the axes separately makes the difference obvious: a face is
   * roughly isotropic, a horizon is not, by an order of magnitude. The floor
   * sits at 0.25 so that an off-centre three-quarter portrait, which is
   * genuinely oval, is not punished for it.
   */
  const isotropy = normalise(
    Math.min(sigmaX, sigmaY) / Math.max(sigmaX, sigmaY, 1e-6),
    0.25,
    0.6,
  );

  const score = unit(areaScore) * compactness * isotropy;

  return {
    score,
    // Only claim a region when the evidence is real. A weak match painted into
    // the protection mask would freeze part of the cover for no reason, and
    // frozen-next-to-moving is more noticeable than either on its own.
    region:
      score < 0.25
        ? null
        : {
            x: cx / size,
            y: cy / size,
            // Two sigma plus a margin: the mask must cover hair and shoulder
            // edges, not just the skin that was matched.
            radius: Math.min(0.6, sigma * 2 + 0.08),
          },
  };
}

/**
 * How strongly the cover is banded left-to-right.
 *
 * Compares the variation *between* rows against the variation *within* them. A
 * sky over a horizon over ground has rows that are each nearly uniform and very
 * different from one another, which sends this toward 1. A portrait or a busy
 * illustration has the opposite profile.
 */
function rowCoherence(fields: PixelFields): number {
  const { size, luma, opaque } = fields;

  const rowMeans = new Float64Array(size);
  let withinTotal = 0;
  let rows = 0;

  for (let y = 0; y < size; y += 1) {
    let n = 0;
    let sum = 0;
    let sumSq = 0;

    for (let x = 0; x < size; x += 1) {
      const p = y * size + x;
      if (!opaque[p]) continue;
      n += 1;
      sum += luma[p];
      sumSq += luma[p] * luma[p];
    }

    if (n === 0) continue;
    const mean = sum / n;
    rowMeans[rows] = mean;
    withinTotal += Math.max(0, sumSq / n - mean * mean);
    rows += 1;
  }

  if (rows === 0) return 0;

  let sum = 0;
  let sumSq = 0;
  for (let y = 0; y < rows; y += 1) {
    sum += rowMeans[y];
    sumSq += rowMeans[y] * rowMeans[y];
  }
  const mean = sum / rows;
  const between = Math.max(0, sumSq / rows - mean * mean);
  const within = withinTotal / rows;

  if (between + within === 0) return 0;
  return unit(between / (between + within));
}
