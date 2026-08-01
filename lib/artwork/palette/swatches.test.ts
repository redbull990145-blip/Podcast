import { describe, expect, it } from "vitest";
import { extractSwatches, type Swatch } from "./swatches";

/**
 * The swatches define what the animation is allowed to be made of: chroma
 * modulation in the shader can only move a pixel toward one of these, so a hue
 * that is wrong here is a hue the artwork never contained appearing inside it.
 */

/** Builds RGBA data from `[count, [r,g,b]]` runs, as the palette module's own tests do. */
function pixels(runs: [number, [number, number, number]][]): Uint8ClampedArray {
  const total = runs.reduce((sum, [count]) => sum + count, 0);
  const data = new Uint8ClampedArray(total * 4);

  let i = 0;
  for (const [count, [r, g, b]] of runs) {
    for (let n = 0; n < count; n += 1) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
      i += 4;
    }
  }

  return data;
}

const bytes = ({ r, g, b }: Swatch) => [
  Math.round(r * 255),
  Math.round(g * 255),
  Math.round(b * 255),
];

describe("extractSwatches", () => {
  it("reports colours in 0–1, ready to be a uniform", () => {
    const { dominant } = extractSwatches(pixels([[100, [255, 128, 0]]]));
    expect(dominant.r).toBeCloseTo(1, 2);
    expect(dominant.g).toBeCloseTo(0.502, 2);
    expect(dominant.b).toBeCloseTo(0, 2);
  });

  it("picks the most common colour as dominant", () => {
    const { dominant } = extractSwatches(
      pixels([
        [900, [40, 60, 130]],
        [100, [220, 40, 40]],
      ]),
    );
    const [r, g, b] = bytes(dominant);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it("does not let a stray vivid pixel become the vibrant swatch", () => {
    // The failure this guards against: one pixel of pure magenta in the corner
    // of a photograph is the most saturated cluster there is, and picking it
    // would tint the whole cover's moving light magenta.
    const { vibrant } = extractSwatches(
      pixels([
        [4000, [180, 90, 50]],
        [3, [255, 0, 255]],
      ]),
    );
    const [r, g, b] = bytes(vibrant);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it("skips crushed and blown clusters when choosing vibrant", () => {
    const { vibrant } = extractSwatches(
      pixels([
        [500, [4, 4, 6]],
        [500, [252, 252, 250]],
        [300, [40, 150, 90]],
      ]),
    );
    const [r, g, b] = bytes(vibrant);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("separates dark from light", () => {
    const { dark, light } = extractSwatches(
      pixels([
        [300, [12, 14, 20]],
        [300, [240, 236, 228]],
        [300, [120, 90, 60]],
      ]),
    );

    const luma = (s: Swatch) => 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
    expect(luma(dark)).toBeLessThan(0.2);
    expect(luma(light)).toBeGreaterThan(0.8);
  });

  it("prefers a low-chroma colour for muted", () => {
    const { muted, vibrant } = extractSwatches(
      pixels([
        [500, [130, 128, 132]],
        [500, [220, 30, 30]],
      ]),
    );

    const spread = (s: Swatch) => Math.max(s.r, s.g, s.b) - Math.min(s.r, s.g, s.b);
    expect(spread(muted)).toBeLessThan(spread(vibrant));
  });

  it("falls back to a neutral for a cover it cannot read", () => {
    const transparent = new Uint8ClampedArray(64 * 4);
    const { dominant, vibrant, all } = extractSwatches(transparent);

    // A neutral, so nothing downstream tints the artwork with a colour that was
    // never in it.
    expect(dominant.r).toBeCloseTo(dominant.g, 2);
    expect(vibrant).toEqual(dominant);
    expect(all).toHaveLength(1);
  });

  it("is deterministic and unaffected by sampling a larger buffer", () => {
    // Striding is what keeps k-means affordable at the 256² analysis size. It
    // must not change which colour a show animates in.
    const small = pixels([
      [500, [200, 60, 60]],
      [500, [60, 90, 200]],
    ]);
    const large = pixels([
      [5000, [200, 60, 60]],
      [5000, [60, 90, 200]],
    ]);

    expect(extractSwatches(small).dominant).toEqual(extractSwatches(small).dominant);
    expect(bytes(extractSwatches(large).dominant)).toEqual(
      bytes(extractSwatches(small).dominant),
    );
  });
});
