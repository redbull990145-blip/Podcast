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
 *
 * Three stages, each doing the thing it is good at. Sharp decodes and samples.
 * node-vibrant's median-cut quantiser reduces those samples to a handful of
 * colours that genuinely exist in the image, each with how much of it it
 * covers. Then `pickAccent` — the part that is ours, and the part with an
 * opinion in it — decides which of them is *the* colour, scored in OKLab so
 * the ranking follows how the eye weighs a cover rather than how sRGB
 * arithmetic happens to fall out.
 */

import { hexToRgb, rgbToHex, rgbToOklab } from '@cue/design';
import type { Palette, Swatch } from '@vibrant/color';
import { checkUrl } from './url-guard.ts';
import { fetchChecked } from './pinned-fetch.ts';
import { SharpImage, Vibrant } from './vibrant.ts';

/** Artwork is small; anything larger is not a cover. */
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** Podcast art redirects through CDNs constantly; each hop is re-validated. */
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Cue/0.1';

/**
 * How many colours median-cut is allowed to resolve the cover into.
 *
 * Vibrant's own default. Fewer, and a cover's two related reds collapse into
 * one averaged red; many more, and the populations get thin enough that the
 * area term in the score stops meaning much.
 */
const COLOR_COUNT = 64;

export type ExtractOptions = { fetchImpl?: typeof fetch };

/**
 * Fetch artwork bytes through the same SSRF guard the feed fetcher uses.
 *
 * An artwork URL comes out of RSS that anyone can publish, so it is exactly as
 * attacker-controlled as the feed that carried it — and this fetch runs
 * server-side, inside the deployment's own network. Without the guard it is a
 * proxy into that network: an `<itunes:image href="http://169.254.169.254/…">`
 * turns colour extraction into a read of the cloud metadata endpoint, reachable
 * unauthenticated through both ingest and the public `/episodes/:id/tint` route.
 *
 * So every hop is re-validated with `redirect: 'manual'` — a public URL that
 * 302s to a private one is the whole redirect-based bypass, and the plain
 * `fetch` this replaced followed those silently. The body is streamed under a
 * hard ceiling rather than buffered whole, because `content-length` is written
 * by the same server we are declining to trust: a tiny declared length in front
 * of a multi-gigabyte body would otherwise exhaust the container's memory before
 * the old post-hoc size check ever ran.
 *
 * Vibrant is handed the bytes this returns and never the URL. Its own loader
 * would fetch an `http://` source quite happily, and knows none of the above.
 */
async function fetchArtwork(url: string, doFetch?: typeof fetch): Promise<Buffer | null> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = await checkUrl(currentUrl);
    if (!check.allowed) return null;

    let response: Response;
    try {
      response = await fetchChecked(check, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
        redirect: 'manual',
      }, doFetch);
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      // Resolved against the current URL, then re-checked at the top of the loop.
      currentUrl = new URL(location, check.url).href;
      continue;
    }

    if (!response.ok) return null;

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) { await response.body?.cancel(); return null; }

    try { return await readCappedImage(response); } catch { return null; }
  }

  return null;
}

/**
 * Read a response body into a Buffer, aborting the moment it passes MAX_BYTES.
 *
 * Counts bytes as they arrive rather than trusting `content-length`, which is
 * the only ceiling that holds against a server lying about its own body size.
 */
async function readCappedImage(response: Response): Promise<Buffer | null> {
  const body = response.body as ReadableStream<Uint8Array> | null;

  // A runtime or test double without a streaming body: buffer whole, still
  // bounded by the length check that follows.
  if (!body || typeof body.getReader !== 'function') {
    const bytes = await response.arrayBuffer();
    return bytes.byteLength > MAX_BYTES ? null : Buffer.from(bytes);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

// ------------------------------------------------------ picking a swatch ---

/**
 * The lightness band where a swatch's hue is worth trusting.
 *
 * Not a band the tint has to *land* in — `deriveTint` re-fits lightness to
 * whatever surface the colour is going on, so a dark swatch gets lifted and a
 * pale one dropped regardless. This is about stability: hue read off a
 * near-black or a blown-out swatch sits a couple of quantisation steps away
 * from being a different hue entirely, and a page whose colour changes because
 * a publisher re-encoded their cover looks accidental.
 */
const PEAK_LOW = 0.5;
const PEAK_HIGH = 0.7;
const FALLOFF = 1.2;
const FALLOFF_FLOOR = 0.2;

/**
 * Below this, a swatch is not a colour — it is a shade of grey the cover
 * happens to contain, and it is not eligible to be the answer.
 *
 * Deliberately just above `refit`'s own 0.02 grey cutoff in `@cue/design`:
 * anything under that is flattened to neutral downstream anyway, so storing it
 * would be recording a colour the product will never paint.
 */
const MIN_CHROMA = 0.025;

/** Plateau across the trustworthy band, linear falloff outside it. */
function lightnessFit(L: number): number {
  if (L >= PEAK_LOW && L <= PEAK_HIGH) return 1;
  const distance = L < PEAK_LOW ? PEAK_LOW - L : L - PEAK_HIGH;
  return Math.max(FALLOFF_FLOOR, 1 - distance * FALLOFF);
}

/**
 * Choose the one colour that reads as this cover's, from Vibrant's six.
 *
 * Vibrant returns `Vibrant` and `Muted` plus light and dark variants of each.
 * Those are names, not a ranking — it holds no opinion about which one a
 * product should wear, and its own notion of "vibrant" is HSL saturation,
 * which overrates yellows and underrates blues by roughly the amount that
 * makes a tinted UI look inconsistent from show to show. So the ranking is
 * ours, in two steps.
 *
 * **Chroma decides who is eligible, not who wins.** Every swatch under
 * `MIN_CHROMA` is dropped outright: it is a grey the cover contains, not a
 * colour it has. This is the whole reason a cover that is 70% near-black and
 * 30% orange comes out orange — the black was never a candidate, so it does
 * not matter that it covers twice as much of the image.
 *
 * **Among real colours, area leads.**
 *
 *     score = population share × √chroma × lightnessFit(L)
 *
 * The square root is the point of the shape: it lets a vivid colour outrank a
 * muted one of similar size while flattening the difference enough that it can
 * never outrank one *much* larger. Ranking on chroma directly, however damped
 * by area, hands a whole page to sixty pixels of neon — and every failure of
 * this function is of that kind, because the wrong answer is always the tiny
 * loud thing rather than the big quiet one.
 *
 * Exported because this is the part with judgement in it, and judgement is
 * worth testing directly rather than through a decoder and a quantiser.
 */
export function pickAccent(palette: Palette): string | null {
  const swatches = Object.values(palette).filter((swatch): swatch is Swatch => swatch !== null);
  if (swatches.length === 0) return null;

  // Share is of the whole cover, greys included: a colour occupying a fifth of
  // the artwork occupies a fifth of it whatever the other four fifths are.
  const totalPopulation = swatches.reduce((sum, swatch) => sum + swatch.population, 0);
  if (totalPopulation === 0) return null;

  let best: { hex: string; score: number } | null = null;

  for (const swatch of swatches) {
    const rgb = hexToRgb(swatch.hex);
    if (!rgb) continue;

    const lab = rgbToOklab(rgb);
    const chroma = Math.hypot(lab.a, lab.b);
    if (chroma < MIN_CHROMA) continue;

    const share = swatch.population / totalPopulation;
    const score = share * Math.sqrt(chroma) * lightnessFit(lab.L);

    if (!best || score > best.score) {
      // The swatch's own colour, never a blend. A quantised swatch is a colour
      // that is actually in the image; an average of several is a colour that
      // is in none of them, and reliably muddier than all of them.
      best = { hex: rgbToHex(rgb), score };
    }
  }

  // Nothing cleared MIN_CHROMA, so the cover is genuinely greyscale — and
  // giving it a hue would be inventing one.
  return best?.hex ?? null;
}

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

  const doFetch = options.fetchImpl;

  // Artwork is decoration. A CDN being slow — or a URL the SSRF guard refuses —
  // must never fail an ingest that otherwise succeeded, so any problem here is
  // simply "no tint".
  const buffer = await fetchArtwork(artworkUrl, doFetch);
  if (!buffer) return null;

  try {
    const palette = await new Vibrant(buffer, {
      ImageClass: SharpImage,
      colorCount: COLOR_COUNT,
      quality: 1,
    }).getPalette();

    return pickAccent(palette);
  } catch {
    // A corrupt or unsupported image is not an ingest failure.
    return null;
  }
}
