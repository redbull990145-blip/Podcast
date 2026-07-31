import { describe, expect, it } from "vitest";
import { FALLBACK_PALETTE, paletteFromPixels } from "./artwork-palette";

/** Builds RGBA pixel data from `[count, [r,g,b], alpha?]` runs. */
function pixels(runs: [number, [number, number, number], number?][]): Uint8ClampedArray {
  const total = runs.reduce((sum, [count]) => sum + count, 0);
  const data = new Uint8ClampedArray(total * 4);

  let i = 0;
  for (const [count, [r, g, b], alpha = 255] of runs) {
    for (let n = 0; n < count; n += 1) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = alpha;
      i += 4;
    }
  }

  return data;
}

function channels(colour: string): [number, number, number] {
  const [r, g, b] = colour.match(/\d+/g)!.map(Number);
  return [r, g, b];
}

const luminance = ([r, g, b]: [number, number, number]) =>
  (0.299 * r + 0.587 * g + 0.114 * b) / 255;

describe("paletteFromPixels", () => {
  it("returns null when every pixel is transparent", () => {
    expect(paletteFromPixels(pixels([[16, [255, 0, 0], 0]]))).toBeNull();
  });

  it("picks the most common colour as the base", () => {
    const palette = paletteFromPixels(
      pixels([
        [90, [40, 60, 120]],
        [10, [200, 30, 30]],
      ]),
    )!;

    const [r, g, b] = channels(palette.base);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("prefers a vivid minority colour over a dominant near-black one", () => {
    // The exact case that made a dark cover render as a black rectangle: most of
    // the art is almost black, with one saturated orange accent.
    const palette = paletteFromPixels(
      pixels([
        [900, [12, 12, 14]],
        [100, [230, 120, 20]],
      ]),
    )!;

    const [r, g, b] = channels(palette.glow);
    expect(r).toBeGreaterThan(150);
    expect(r).toBeGreaterThan(b);
  });

  it("ignores desaturated colours when choosing the glow", () => {
    const palette = paletteFromPixels(
      pixels([
        [500, [130, 130, 132]],
        [50, [20, 190, 90]],
      ]),
    )!;

    const [r, g, b] = channels(palette.glow);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("lifts a greyscale cover instead of returning black", () => {
    const palette = paletteFromPixels(pixels([[100, [18, 18, 18]]]))!;

    expect(luminance(channels(palette.glow))).toBeGreaterThan(0.25);
    expect(luminance(channels(palette.base))).toBeGreaterThan(0.25);
  });

  it("lifts pure black to a neutral rather than dividing by zero", () => {
    const palette = paletteFromPixels(pixels([[100, [0, 0, 0]]]))!;
    const [r, g, b] = channels(palette.glow);

    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(luminance([r, g, b])).toBeGreaterThan(0.25);
  });

  it("leaves an already-bright colour alone", () => {
    const palette = paletteFromPixels(pixels([[100, [200, 60, 60]]]))!;
    expect(channels(palette.glow)).toEqual([200, 60, 60]);
  });

  it("skips near-white pixels when choosing the glow", () => {
    const palette = paletteFromPixels(
      pixels([
        [800, [252, 250, 245]],
        [200, [30, 90, 200]],
      ]),
    )!;

    const [r, , b] = channels(palette.glow);
    expect(b).toBeGreaterThan(r);
  });

  it("merges near-identical shades into one bucket", () => {
    // Four shades of the same red plus one blue: the reds must not be split into
    // four small buckets that individually lose to the blue.
    const palette = paletteFromPixels(
      pixels([
        [25, [200, 40, 40]],
        [25, [202, 42, 41]],
        [25, [199, 41, 43]],
        [25, [201, 43, 42]],
        [40, [40, 40, 200]],
      ]),
    )!;

    const [r, , b] = channels(palette.glow);
    expect(r).toBeGreaterThan(b);
  });
});

/** 0 (grey) to 1, from the HSL definition — mirrors the module's own maths. */
function hslSaturation([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function hslLightness([r, g, b]: [number, number, number]): number {
  return (Math.max(r, g, b) / 255 + Math.min(r, g, b) / 255) / 2;
}

describe("mesh (ambient backdrop colours)", () => {
  it("tones down a fully-saturated logo colour instead of rendering it as a warning light", () => {
    const palette = paletteFromPixels(pixels([[400, [255, 0, 0]]]))!;
    expect(hslSaturation(channels(palette.mesh[0]))).toBeLessThanOrEqual(0.58);
  });

  it("lifts a dishwater-grey cover so its colours still read as colour", () => {
    const palette = paletteFromPixels(pixels([[400, [90, 88, 92]]]))!;
    for (const colour of palette.mesh) {
      expect(hslLightness(channels(colour))).toBeGreaterThanOrEqual(0.2);
    }
  });

  it("keeps every mesh colour dark enough to hold white text", () => {
    const palette = paletteFromPixels(
      pixels([
        [500, [250, 240, 40]],
        [300, [40, 240, 250]],
      ]),
    )!;
    for (const colour of palette.mesh) {
      expect(hslLightness(channels(colour))).toBeLessThanOrEqual(0.42);
    }
  });

  it("picks more than one colour when the cover actually has more than one", () => {
    const palette = paletteFromPixels(
      pixels([
        [500, [200, 60, 60]],
        [500, [60, 90, 200]],
      ]),
    )!;
    expect(palette.mesh.length).toBeGreaterThanOrEqual(2);

    const [r1] = channels(palette.mesh[0]);
    const [r2] = channels(palette.mesh[1]);
    // The two chosen colours must actually differ, not both collapse to the
    // same muted grey under the matte clamp.
    expect(Math.abs(r1 - r2)).toBeGreaterThan(10);
  });

  it("still returns at least two colours for a single-colour cover", () => {
    const palette = paletteFromPixels(pixels([[400, [80, 120, 200]]]))!;
    expect(palette.mesh.length).toBeGreaterThanOrEqual(2);
  });

  it("never returns more than three mesh colours", () => {
    const palette = paletteFromPixels(
      pixels([
        [200, [200, 60, 60]],
        [200, [60, 200, 60]],
        [200, [60, 60, 200]],
        [200, [200, 200, 60]],
      ]),
    )!;
    expect(palette.mesh.length).toBeLessThanOrEqual(3);
  });

  it("gives the fallback palette a usable mesh", () => {
    expect(FALLBACK_PALETTE.mesh.length).toBeGreaterThanOrEqual(2);
  });
});
