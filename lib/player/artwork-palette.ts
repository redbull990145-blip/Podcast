"use client";

/**
 * Pulls a colour palette out of podcast artwork, for the Now Playing backdrop.
 *
 * The awkward part is CORS: reading pixels back out of a canvas that has drawn
 * a cross-origin image taints it and `getImageData` throws, and podcast artwork
 * lives on hosts we do not control and that mostly send no CORS headers.
 *
 * The way around it is to load the image through Next's own image endpoint. That
 * is same-origin, so the canvas stays clean, and asking for a 64px version means
 * we download a couple of kilobytes instead of the 3000px original the publisher
 * uploaded. Nothing here needs a colour-extraction dependency.
 */

export type ArtworkPalette = {
  /** The most vivid colour in the art — drives the top of the gradient. */
  glow: string;
  /** The most common colour — drives the body of the gradient. */
  base: string;
};

/** Sampling grid. 32x32 is plenty to find dominant colours and costs nothing. */
const SAMPLE_SIZE = 32;

/** Palettes are stable per image, so never compute one twice in a session. */
const cache = new Map<string, ArtworkPalette | null>();
const inFlight = new Map<string, Promise<ArtworkPalette | null>>();

/** What we fall back to when the art can't be read — a neutral slate. */
export const FALLBACK_PALETTE: ArtworkPalette = {
  glow: "rgb(88, 84, 122)",
  base: "rgb(42, 42, 58)",
};

/**
 * Routes a remote image through the optimizer so it arrives same-origin and
 * small. Local paths are already same-origin and need no help.
 *
 * `w` and `q` must both be values the image config permits — Next answers 400
 * for anything else — so this uses the default quality of 75 rather than a
 * lower one. That is the right call anyway: 75 is what every <Image> on the
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

type Bucket = { r: number; g: number; b: number; count: number };

/**
 * Groups pixels into coarse colour buckets.
 *
 * Quantizing to 4 bits per channel merges the near-identical shades that
 * gradients and JPEG artefacts produce, so a photo of one red jacket registers
 * as one red rather than four hundred slightly different reds.
 */
function bucketPixels(data: Uint8ClampedArray): Map<number, Bucket> {
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < data.length; i += 4) {
    // Skip anything meaningfully transparent — usually a logo's padding.
    if (data[i + 3] < 125) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

    const existing = buckets.get(key);
    if (existing) {
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count += 1;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  return buckets;
}

function average(bucket: Bucket) {
  return {
    r: Math.round(bucket.r / bucket.count),
    g: Math.round(bucket.g / bucket.count),
    b: Math.round(bucket.b / bucket.count),
  };
}

/** 0 (grey) to 1 (fully saturated), from the HSL definition. */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const lightness = (max + min) / 2 / 255;
  const delta = (max - min) / 255;
  return lightness > 0.5 ? delta / (2 - max / 255 - min / 255) : delta / (max / 255 + min / 255);
}

/** Perceived brightness, 0-1. Weighted because green reads far brighter than blue. */
function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function rgb({ r, g, b }: { r: number; g: number; b: number }): string {
  return `rgb(${r}, ${g}, ${b})`;
}

type Colour = { r: number; g: number; b: number };

/**
 * Below these, a colour is too washed out or too close to black/white to carry
 * a gradient. Weighting saturation instead of excluding outright is not enough:
 * a dark cover has so many near-black pixels that sheer count wins anyway, and
 * the result is a black rectangle.
 */
const MIN_GLOW_SATURATION = 0.18;
const MIN_GLOW_LUMINANCE = 0.12;
const MAX_GLOW_LUMINANCE = 0.9;

/** Where a lifted fallback colour lands. Dark enough for white text to sit on. */
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

/** Exported for tests — the pixel decoding above needs a real canvas. */
export function paletteFromPixels(data: Uint8ClampedArray): ArtworkPalette | null {
  const buckets = [...bucketPixels(data).values()];
  if (buckets.length === 0) return null;

  const colours = buckets.map((bucket) => {
    const { r, g, b } = average(bucket);
    return { r, g, b, count: bucket.count, sat: saturation(r, g, b), lum: luminance(r, g, b) };
  });

  // The body colour is simply whatever covers the most of the artwork.
  const base = colours.reduce((best, c) => (c.count > best.count ? c : best));

  // The accent is the colour someone would name if asked what the cover looks
  // like. Candidates are filtered to ones that can actually carry a gradient
  // first, then ranked by how much of the cover they occupy.
  const candidates = colours.filter(
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
      : // Nothing vivid anywhere — a greyscale or very dark cover.
        lift(base);

  return { glow: rgb(glow), base: rgb(lift(base)) };
}

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
