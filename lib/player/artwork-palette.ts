"use client";

/**
 * Pulls a colour palette out of podcast artwork, for the Now Playing backdrop.
 *
 * Uses k-means clustering (k = 4) to find the true dominant colours rather than
 * the coarse bucket quantisation from before.  K-means converges to cluster
 * centres that represent what a human would describe as "the colours in this
 * image", which is what Apple Music, Spotify and every other player with a
 * dynamic backdrop uses under the hood.
 *
 * The awkward part is CORS: reading pixels back out of a canvas that has drawn
 * a cross-origin image taints it and `getImageData` throws, and podcast artwork
 * lives on hosts we do not control and that mostly send no CORS headers.
 *
 * The way around it is to load the image through Next's own image endpoint. That
 * is same-origin, so the canvas stays clean, and asking for a 64px version means
 * we download a couple of kilobytes instead of the 3000px original the publisher
 * uploaded.  Nothing here needs a colour-extraction dependency.
 */

export type ArtworkPalette = {
  /** The most vivid colour in the art — drives the top of the gradient. */
  glow: string;
  /** The most common colour — drives the body of the gradient. */
  base: string;
  /** 3–4 dominant colours from k-means, sorted by cluster size (most pixels first). */
  colors: string[];
  /**
   * 2–3 colours reshaped for an ambient backdrop — see `matteTone`. Ordered by
   * how much of the cover they came from, most first.
   */
  mesh: string[];
};

/** Sampling grid.  48×48 gives k-means enough data without being expensive. */
const SAMPLE_SIZE = 48;

/** Palettes are stable per image, so never compute one twice in a session. */
const cache = new Map<string, ArtworkPalette | null>();
const inFlight = new Map<string, Promise<ArtworkPalette | null>>();

/** What we fall back to when the art can't be read — a neutral slate. */
export const FALLBACK_PALETTE: ArtworkPalette = {
  glow: "rgb(88, 84, 122)",
  base: "rgb(42, 42, 58)",
  colors: ["rgb(88, 84, 122)", "rgb(42, 42, 58)", "rgb(60, 58, 80)"],
  mesh: ["rgb(76, 72, 104)", "rgb(48, 46, 68)"],
};

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

/**
 * Routes a remote image through the optimizer so it arrives same-origin and
 * small.  Local paths are already same-origin and need no help.
 *
 * `w` and `q` must both be values the image config permits — Next answers 400
 * for anything else — so this uses the default quality of 75 rather than a
 * lower one.  That is the right call anyway: 75 is what every <Image> on the
 * page already requests, so this reuses a cache entry instead of forcing a
 * second transformation of the same artwork.
 */
function sameOriginUrl(src: string): string {
  if (!/^https?:/i.test(src)) return src;
  return `/_next/image?url=${encodeURIComponent(src)}&w=64&q=75`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/** 0 (grey) to 1 (fully saturated), from the HSL definition. */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const lightness = (max + min) / 2 / 255;
  const delta = (max - min) / 255;
  return lightness > 0.5 ? delta / (2 - max / 255 - min / 255) : delta / (max / 255 + min / 255);
}

/** Perceived brightness, 0-1.  Weighted because green reads far brighter than blue. */
function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function rgb({ r, g, b }: { r: number; g: number; b: number }): string {
  return `rgb(${r}, ${g}, ${b})`;
}

type Colour = { r: number; g: number; b: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsl({ r, g, b }: Colour): { h: number; s: number; l: number } {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;

  return { h: h * 60, s, l };
}

function hslToRgb(h: number, s: number, l: number): Colour {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const hueToChannel = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;

  return {
    r: Math.round(hueToChannel(p, q, hk + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, hk) * 255),
    b: Math.round(hueToChannel(p, q, hk - 1 / 3) * 255),
  };
}

// ---------------------------------------------------------------------------
// K-means clustering
// ---------------------------------------------------------------------------

/**
 * K-means clustering for dominant colour extraction.
 *
 * Deterministic: initial centroids are picked by the k-means++ max-distance
 * strategy, starting from the first non-transparent pixel.  This avoids the
 * random-seed instability that would make the backdrop flicker between loads.
 */
function kMeans(
  pixels: Array<[number, number, number]>,
  k: number,
  maxIter = 12,
): Array<{ r: number; g: number; b: number; count: number }> {
  const n = pixels.length;
  if (n === 0) return [];
  if (n <= k) return pixels.map(([r, g, b]) => ({ r, g, b, count: 1 }));

  // --- deterministic k-means++ initialisation ---
  const centroids: Array<[number, number, number]> = [
    [pixels[0][0], pixels[0][1], pixels[0][2]],
  ];

  // Each subsequent centroid is the pixel farthest from all existing centroids.
  for (let c = 1; c < k; c++) {
    let maxDist = -1;
    let farthest = 0;
    for (let p = 0; p < n; p++) {
      let minDist = Infinity;
      for (let j = 0; j < centroids.length; j++) {
        const dr = pixels[p][0] - centroids[j][0];
        const dg = pixels[p][1] - centroids[j][1];
        const db = pixels[p][2] - centroids[j][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < minDist) minDist = d;
      }
      if (minDist > maxDist) {
        maxDist = minDist;
        farthest = p;
      }
    }
    centroids.push([pixels[farthest][0], pixels[farthest][1], pixels[farthest][2]]);
  }

  // --- iterate: assign → update ---
  const assignments = new Int32Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    // Assign each pixel to its nearest centroid.
    for (let p = 0; p < n; p++) {
      let minDist = Infinity;
      let closest = 0;
      for (let c = 0; c < k; c++) {
        const dr = pixels[p][0] - centroids[c][0];
        const dg = pixels[p][1] - centroids[c][1];
        const db = pixels[p][2] - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < minDist) {
          minDist = d;
          closest = c;
        }
      }
      if (assignments[p] !== closest) {
        assignments[p] = closest;
        changed = true;
      }
    }

    if (!changed) break;

    // Recompute centroids as the mean of their members.
    for (let c = 0; c < k; c++) {
      let sumR = 0,
        sumG = 0,
        sumB = 0,
        count = 0;
      for (let p = 0; p < n; p++) {
        if (assignments[p] === c) {
          sumR += pixels[p][0];
          sumG += pixels[p][1];
          sumB += pixels[p][2];
          count++;
        }
      }
      if (count > 0) {
        centroids[c] = [sumR / count, sumG / count, sumB / count];
      }
    }
  }

  // Count final cluster sizes.
  const counts = new Array(k).fill(0) as number[];
  for (let p = 0; p < n; p++) counts[assignments[p]]++;

  return centroids.map((c, i) => ({
    r: Math.round(c[0]),
    g: Math.round(c[1]),
    b: Math.round(c[2]),
    count: counts[i],
  }));
}

// ---------------------------------------------------------------------------
// Palette selection
// ---------------------------------------------------------------------------

/**
 * Below these, a colour is too washed out or too close to black/white to carry
 * a gradient.  Weighting saturation instead of excluding outright is not enough:
 * a dark cover has so many near-black pixels that sheer count wins anyway, and
 * the result is a black rectangle.
 */
const MIN_GLOW_SATURATION = 0.15;
const MIN_GLOW_LUMINANCE = 0.10;
const MAX_GLOW_LUMINANCE = 0.92;

/** Where a lifted fallback colour lands.  Dark enough for white text to sit on. */
const LIFT_TARGET_LUMINANCE = 0.34;

/**
 * Brightens a colour toward a target luminance while holding its hue.
 *
 * This is what saves monochrome and very dark artwork: rather than giving up
 * and rendering black, the backdrop becomes a lifted version of the cover's own
 * grey or navy, which still reads as belonging to that show.
 */
function lift(colour: Colour): Colour {
  const current = luminance(colour.r, colour.g, colour.b);
  if (current >= LIFT_TARGET_LUMINANCE) return colour;

  // A pure black cover has no hue to preserve, so scaling gets us nowhere —
  // use a neutral charcoal instead of dividing by zero.
  if (current < 0.02) {
    const level = Math.round(LIFT_TARGET_LUMINANCE * 255);
    return { r: level, g: level, b: level };
  }

  const factor = LIFT_TARGET_LUMINANCE / current;
  return {
    r: Math.min(255, Math.round(colour.r * factor)),
    g: Math.min(255, Math.round(colour.g * factor)),
    b: Math.min(255, Math.round(colour.b * factor)),
  };
}

// ---------------------------------------------------------------------------
// Mesh backdrop
// ---------------------------------------------------------------------------

/**
 * Bounds a raw cluster colour is reshaped into for the ambient backdrop.
 *
 * A cluster centroid is whatever the cover happens to contain, and covers
 * contain two problem cases: a fully-saturated primary from a logo or a text
 * card, and dishwater grey from flat photography. Rendered as-is, the first
 * reads as a warning light behind the controls and the second reads as fog
 * rather than colour. Clamping saturation into a band gives both the same
 * jewel-tone richness; clamping lightness the same way keeps every colour dark
 * enough to hold white text and light enough to still register as a colour.
 * The result is deliberately narrower than what the human eye can tell apart —
 * that's the "matte" instead of "glossy" difference: every cover lands
 * somewhere in the same rich, muted register instead of however saturated the
 * original photo or logo happened to be.
 */
const MESH_MIN_SATURATION = 0.32;
const MESH_MAX_SATURATION = 0.58;
const MESH_MIN_LIGHTNESS = 0.2;
const MESH_MAX_LIGHTNESS = 0.42;

function matteTone(colour: Colour): Colour {
  const { h, s, l } = rgbToHsl(colour);
  return hslToRgb(
    h,
    clamp(s, MESH_MIN_SATURATION, MESH_MAX_SATURATION),
    clamp(l, MESH_MIN_LIGHTNESS, MESH_MAX_LIGHTNESS),
  );
}

function colourDistance(a: Colour, b: Colour): number {
  const dr = a.r - b.r,
    dg = a.g - b.g,
    db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Below this RGB distance, two clusters would paint as the same colour in two
 * different spots — which reads as a mistake, not a second colour.
 */
const MESH_MIN_DISTANCE = 36;

/**
 * Up to three colours for the ambient backdrop, ranked the way `glow` is —
 * weighted toward whichever clusters are both vivid and cover a lot of the
 * image — but keeping several instead of just the winner, and skipping any
 * that would sit almost on top of one already chosen.
 *
 * A single-colour cover (a photo of a clear sky, a plain text card) can fail
 * to produce two distinct clusters; a lifted echo of what little there is
 * still gives the backdrop some depth, rather than one flat colour filling
 * the whole screen.
 */
function pickMeshColours(
  analysed: Array<{ r: number; g: number; b: number; count: number; sat: number; lum: number }>,
): Colour[] {
  const ranked = [...analysed].sort(
    (a, b) => b.count * (0.3 + b.sat) - a.count * (0.3 + a.sat),
  );

  const chosen: Colour[] = [];
  for (const c of ranked) {
    if (chosen.length >= 3) break;
    if (chosen.some((picked) => colourDistance(picked, c) < MESH_MIN_DISTANCE)) continue;
    chosen.push(c);
  }

  while (chosen.length < 2 && analysed.length > 0) {
    chosen.push(lift(analysed[chosen.length % analysed.length]));
  }

  return chosen;
}

/**
 * A cluster centre with the two properties every consumer sorts on.
 *
 * Exported because the artwork animation engine in `lib/artwork/` needs the
 * same clusters for a different purpose — classifying them into named swatches
 * for its shaders — and running k-means a second time over the same cover would
 * be both wasteful and, more importantly, capable of disagreeing with this one.
 */
export type ColourCluster = Colour & { count: number; sat: number; lum: number };

/**
 * Clusters an RGBA buffer into its dominant colours, most pixels first.
 *
 * `maxSamples` strides the collection so a large buffer costs the same as a
 * small one. K-means is O(pixels × k × iterations), and the animation engine
 * analyses at 256² — 65k pixels, or roughly thirty times what this module's own
 * 48² sampling produces, which would turn a two-millisecond pass into a
 * frame-dropping one. Striding to a few thousand samples changes the resulting
 * centres by less than a quantisation step; the dominant colours of an image
 * are not a detail that needs every pixel to find.
 *
 * The default is unlimited, so this module's own behaviour is unchanged.
 */
export function clusterColours(
  data: Uint8ClampedArray,
  k = 4,
  maxSamples = Infinity,
): ColourCluster[] {
  const total = data.length / 4;
  const stride = Math.max(1, Math.ceil(total / maxSamples));

  // Collect pixels, skipping transparent ones.
  const pixels: Array<[number, number, number]> = [];
  for (let p = 0; p < total; p += stride) {
    const i = p * 4;
    if (data[i + 3] < 125) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (pixels.length === 0) return [];

  const clusters = kMeans(pixels, k);
  if (clusters.length === 0) return [];

  // Sort by pixel count so the most dominant colour is first.
  clusters.sort((a, b) => b.count - a.count);

  return clusters.map((c) => ({
    ...c,
    sat: saturation(c.r, c.g, c.b),
    lum: luminance(c.r, c.g, c.b),
  }));
}

/** Exported for tests — the pixel decoding above needs a real canvas. */
export function paletteFromPixels(data: Uint8ClampedArray): ArtworkPalette | null {
  const analysed = clusterColours(data, 4);
  if (analysed.length === 0) return null;

  // Base: the most dominant colour.
  const base = analysed[0];

  // Glow: the most vivid colour that can carry a gradient.
  const candidates = analysed.filter(
    (c) =>
      c.sat >= MIN_GLOW_SATURATION &&
      c.lum > MIN_GLOW_LUMINANCE &&
      c.lum < MAX_GLOW_LUMINANCE,
  );

  const glow =
    candidates.length > 0
      ? candidates.reduce((best, c) =>
          c.count * (0.3 + c.sat) > best.count * (0.3 + best.sat) ? c : best,
        )
      : lift(base);

  // All cluster centres, ordered by count.
  const colors = analysed.map((c) => rgb(c));

  const mesh = pickMeshColours(analysed).map((c) => rgb(matteTone(c)));

  return { glow: rgb(glow), base: rgb(lift(base)), colors, mesh };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads the dominant colours out of an artwork URL.
 *
 * Never throws and never rejects — artwork is decoration, so a host that blocks
 * us or an image that 404s just yields null and the caller uses the fallback.
 */
export async function extractArtworkPalette(
  src: string | null | undefined,
): Promise<ArtworkPalette | null> {
  if (!src || typeof document === "undefined") return null;

  const cached = cache.get(src);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(src);
  if (pending) return pending;

  const task = (async () => {
    try {
      const img = await loadImage(sameOriginUrl(src));

      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;

      // willReadFrequently keeps this on the CPU path; we read once and discard,
      // so uploading the bitmap to the GPU first would be pure overhead.
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

      return paletteFromPixels(data);
    } catch {
      return null;
    }
  })();

  inFlight.set(src, task);
  const result = await task;
  inFlight.delete(src);
  cache.set(src, result);
  return result;
}
