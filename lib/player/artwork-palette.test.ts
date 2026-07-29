import { describe, expect, it } from "vitest";
import { paletteFromPixels } from "./artwork-palette";

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
