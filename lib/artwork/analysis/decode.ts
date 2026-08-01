"use client";

/**
 * The one place this engine touches the DOM to get at pixels.
 *
 * Everything about this file exists because of a constraint that
 * `lib/player/artwork-palette.ts` found first and solved: podcast artwork comes
 * from hosts we do not control, and almost none of them send CORS headers.
 *
 * For a 2D canvas that means a tainted canvas and a throwing `getImageData`.
 * **For WebGL it is worse.** Uploading a texture from an image that is not
 * origin-clean does not degrade — it throws `SecurityError`, and there is no
 * mode in which it renders anyway. So a naive `TextureLoader().load(artworkUrl)`
 * fails outright on the majority of real feeds, and no amount of shader work
 * gets round it.
 *
 * Routing through Next's own image endpoint is what makes the whole engine
 * possible: the bytes arrive same-origin, so both the canvas read and the WebGL
 * texture upload are legal. The optimizer fetches server-side, where CORS does
 * not apply.
 */

/**
 * Analysis resolution.
 *
 * 256 rather than something smaller because of one metric. A podcast title
 * typically occupies 6–10% of the cover's height, which at 128px leaves glyph
 * strokes barely a pixel wide — below the resolution at which `text.ts` can
 * count the horizontal transitions that distinguish typography from a hard
 * edge. At 256px those strokes are 2–3px and the signal is unambiguous. The
 * protection mask sharpens for the same reason.
 *
 * It must also be a width `next.config.ts` permits. 256 is the top of
 * `imageSizes`; the next step up is 640, which quadruples the work for no
 * further gain in a metric that has already saturated.
 */
export const ANALYSIS_SIZE = 256;

/**
 * Display resolution for the WebGL texture.
 *
 * Not a free choice either. It must be in `deviceSizes`, and 640 is the value
 * Now Playing's own `<Image width={640}>` already requests — so by asking for
 * exactly this URL the engine gets its texture out of the HTTP cache rather
 * than off the network. The animation costs no additional bytes on the surface
 * it ships to.
 */
export const TEXTURE_SIZE = 640;

/**
 * Quality must be 75.
 *
 * Not because 75 is the right quality, but because it is the quality every
 * other `<Image>` on the page requests. Next answers 400 for a `q` outside its
 * configured set, and asking for a different permitted value would force a
 * second transformation of artwork already transformed once.
 */
const QUALITY = 75;

/** Local paths are already same-origin and need no help. */
function sameOriginUrl(src: string, width: number): string {
  if (!/^https?:/i.test(src)) return src;
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${QUALITY}`;
}

/** The URL the WebGL texture should be loaded from. Exported for the renderer. */
export function textureUrl(src: string): string {
  return sameOriginUrl(src, TEXTURE_SIZE);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("artwork failed to load"));
    img.src = src;
  });
}

/**
 * Fetches artwork and reads its pixels back at `ANALYSIS_SIZE`.
 *
 * Returns null rather than throwing on any failure. Artwork animation is
 * decoration: a host that blocks us, an image that 404s, or a browser without a
 * 2D context all mean the caller keeps showing the static image, which is
 * exactly what it was showing anyway.
 */
export async function decodeArtwork(src: string): Promise<Uint8ClampedArray | null> {
  if (typeof document === "undefined") return null;

  try {
    const img = await loadImage(sameOriginUrl(src, ANALYSIS_SIZE));

    const canvas = document.createElement("canvas");
    canvas.width = ANALYSIS_SIZE;
    canvas.height = ANALYSIS_SIZE;

    // `willReadFrequently` keeps this on the CPU path. We read once and discard,
    // so uploading the bitmap to the GPU first would be pure overhead — the same
    // reasoning the palette extractor uses.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
    return ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE).data;
  } catch {
    return null;
  }
}

/**
 * Runs `task` when the browser is idle, or after `timeout` at the latest.
 *
 * The analysis pass is 15–20ms of straight-line arithmetic. That is nothing in
 * isolation and quite a lot during the frames in which the Now Playing sheet is
 * springing open, which is exactly when it would otherwise run. Deferring it
 * costs nothing visible — the static artwork is on screen throughout, and the
 * canvas only ever fades in once there is something to show.
 *
 * Safari has no `requestIdleCallback`, so it gets the timeout path.
 */
export function whenIdle(task: () => void, timeout = 2000): () => void {
  if (typeof window === "undefined") return () => {};

  // Tested by type rather than with `in`: lib.dom declares `requestIdleCallback`
  // as always present, so an `in` check narrows the fallback branch to `never`
  // and the Safari path stops compiling.
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout });
    return () => window.cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(task, 120);
  return () => window.clearTimeout(handle);
}
