/**
 * Pulling the dominant colour out of podcast artwork.
 *
 * Runs once per show at ingest. Two reasons it cannot happen in the client:
 * podcast artwork is served from arbitrary CDNs that send no CORS headers, so
 * a browser canvas cannot read its pixels at all; and doing it per-device
 * would repeat the same work on every phone that ever opens the app.
 *
 * "Dominant" here does not mean "average". Averaging a cover gives mud —
 * every image with a bright subject on a dark ground averages to grey-brown.
 * What we want is the colour a person would *name* if asked what colour the
 * cover is, which is the most chromatic region that occupies real area.
 */

import sharp from 'sharp';

/** Artwork is small; anything larger is not a cover. */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** Sample grid. 16×16 is enough to find a dominant region and costs nothing. */
const GRID = 16;

type Bucket = { r: number; g: number; b: number; count: number; score: number };

/**
 * Score a pixel by how much it would read as "the colour of this cover".
 *
 * Saturation dominates, because a cover that is 70% near-black and 30% orange
 * is an orange cover to everyone who looks at it. Extremes are pushed down:
 * near-white and near-black carry no hue worth keeping.
 */
function vibrance(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const lightness = max / 255;

  // Peaks around mid-lightness and falls off at both ends.
  const lightnessWeight = 1 - Math.abs(lightness - 0.55) * 1.6;

  return saturation * Math.max(0, lightnessWeight);
}

export type ExtractOptions = { fetchImpl?: typeof fetch };

/**
 * Returns `#RRGGBB`, or null when there is nothing usable.
 *
 * Null is a real answer: a show with no artwork, an unreachable CDN, or a
 * genuinely greyscale cover all mean "no tint", and the UI falls back to the
 * neutral chrome rather than inventing a colour.
 */
export async function extractArtworkColor(
  artworkUrl: string | null,
  options: ExtractOptions = {},
): Promise<string | null> {
  if (!artworkUrl) return null;

  const doFetch = options.fetchImpl ?? fetch;

  let buffer: Buffer;
  try {
    const response = await doFetch(artworkUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Cue/0.1', accept: 'image/*' },
    });

    if (!response.ok) return null;

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return null;

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return null;

    buffer = Buffer.from(bytes);
  } catch {
    // Artwork is decoration. A CDN being slow must never fail an ingest that
    // otherwise succeeded.
    return null;
  }

  try {
    const { data } = await sharp(buffer)
      // Ignore the alpha channel: a transparent PNG's empty corners are not
      // part of the cover's colour.
      .flatten({ background: '#000000' })
      .resize(GRID, GRID, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Quantise into coarse buckets so near-identical pixels group together.
    const buckets = new Map<number, Bucket>();

    for (let i = 0; i + 2 < data.length; i += 3) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;

      const score = vibrance(r, g, b);
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

      const existing = buckets.get(key);
      if (existing) {
        existing.r += r;
        existing.g += g;
        existing.b += b;
        existing.count += 1;
        existing.score += score;
      } else {
        buckets.set(key, { r, g, b, count: 1, score });
      }
    }

    if (buckets.size === 0) return null;

    // Rank by total vibrance: area × how colourful. A large dull region loses
    // to a smaller vivid one, which is how people actually read a cover.
    let best: Bucket | null = null;
    for (const bucket of buckets.values()) {
      if (!best || bucket.score > best.score) best = bucket;
    }

    if (!best) return null;

    // A cover with no chromatic region anywhere is genuinely greyscale, and
    // giving it a hue would be inventing one.
    if (best.score / best.count < 0.05) return null;

    const r = Math.round(best.r / best.count);
    const g = Math.round(best.g / best.count);
    const b = Math.round(best.b / best.count);

    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
  } catch {
    // A corrupt or unsupported image is not an ingest failure.
    return null;
  }
}
