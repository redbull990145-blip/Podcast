/**
 * Named colour roles for the shaders.
 *
 * The engine's hardest colour rule — "never introduce completely new colours" —
 * is enforced by construction rather than by tuning: chroma modulation in the
 * shader can only ever move a pixel *along the line toward one of these
 * swatches*, so a hue the artwork does not contain is unreachable no matter
 * what a profile asks for. That makes this file the definition of what the
 * animation is allowed to be made of.
 *
 * The clusters come from `lib/player/artwork-palette.ts`, which already does
 * deterministic k-means and already solved reading pixels out of cross-origin
 * artwork. Running a second, different colour extractor here would mean two
 * answers to "what colour is this cover" that could disagree — the backdrop
 * behind Now Playing and the light moving inside its artwork drifting apart on
 * the same show. One clustering, two consumers.
 */

import { clusterColours, type ColourCluster } from "@/lib/player/artwork-palette";

/** A colour in 0–1 sRGB, ready to become a `vec3` uniform. */
export type Swatch = { r: number; g: number; b: number };

export type ArtworkSwatches = {
  /** Covers the most pixels. The colour someone would name if asked. */
  dominant: Swatch;
  /** The most chromatic colour that is neither crushed nor blown out. */
  vibrant: Swatch;
  /** The least chromatic substantial colour — where a light field can rest. */
  muted: Swatch;
  /** Darkest cluster. Shadow modules move toward this rather than toward black. */
  dark: Swatch;
  /** Lightest cluster. Glow and sweep modules move toward this rather than toward white. */
  light: Swatch;
  /** Every cluster, most pixels first. */
  all: Swatch[];
};

/**
 * How many samples the clustering sees.
 *
 * The analysis buffer is 256² — 65k pixels. K-means over all of them would cost
 * more than every other metric in the pipeline combined, to move the cluster
 * centres by less than one quantisation step.
 */
const MAX_SAMPLES = 4096;

/** Outside this luminance band a colour is too crushed or too blown to carry chroma. */
const VIBRANT_LUMINANCE = [0.12, 0.9] as const;

/** Used when a cover has no readable colour at all. A neutral that will not tint anything. */
const NEUTRAL: Swatch = { r: 0.42, g: 0.42, b: 0.46 };

function toSwatch({ r, g, b }: ColourCluster): Swatch {
  return { r: r / 255, g: g / 255, b: b / 255 };
}

export function extractSwatches(data: Uint8ClampedArray): ArtworkSwatches {
  const clusters = clusterColours(data, 5, MAX_SAMPLES);

  if (clusters.length === 0) {
    return {
      dominant: NEUTRAL,
      vibrant: NEUTRAL,
      muted: NEUTRAL,
      dark: NEUTRAL,
      light: NEUTRAL,
      all: [NEUTRAL],
    };
  }

  const dominant = clusters[0];

  /*
   * Vibrancy is scored on chroma *and* coverage, not chroma alone.
   *
   * A single stray pixel of pure magenta in the corner of a photograph is the
   * most saturated cluster k-means will find, and picking it would mean the
   * whole cover's light drifts magenta. Weighting by how much of the artwork a
   * cluster actually covers is what keeps the answer to "what colour is this
   * show" recognisable — it is the same weighting the mesh backdrop uses, for
   * the same reason.
   */
  const chromatic = clusters.filter(
    (c) => c.lum >= VIBRANT_LUMINANCE[0] && c.lum <= VIBRANT_LUMINANCE[1],
  );
  const vibrant = best(chromatic.length > 0 ? chromatic : clusters, (c) =>
    c.sat * Math.sqrt(c.count),
  );

  // Muted is the counterpart: low chroma, but still a real part of the cover.
  const muted = best(clusters, (c) => (1 - c.sat) * Math.sqrt(c.count));

  return {
    dominant: toSwatch(dominant),
    vibrant: toSwatch(vibrant),
    muted: toSwatch(muted),
    dark: toSwatch(best(clusters, (c) => -c.lum)),
    light: toSwatch(best(clusters, (c) => c.lum)),
    all: clusters.map(toSwatch),
  };
}

/** The cluster with the highest score. Ties go to the earlier one, so this stays deterministic. */
function best(clusters: ColourCluster[], score: (c: ColourCluster) => number): ColourCluster {
  let winner = clusters[0];
  let highest = score(winner);

  for (let i = 1; i < clusters.length; i += 1) {
    const value = score(clusters[i]);
    if (value > highest) {
      highest = value;
      winner = clusters[i];
    }
  }

  return winner;
}
