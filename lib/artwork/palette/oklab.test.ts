import { describe, expect, it } from "vitest";
import { oklabToSrgb, srgbToOklab } from "./oklab";
import type { Swatch } from "./swatches";

/**
 * These constants exist twice — here and in `shaders/lib/oklab.ts` — because
 * the swatches are converted on the CPU while the pixels are converted on the
 * GPU. Two copies of a matrix can drift, so the round trip is pinned here, and
 * the shader's identity check in the dev gallery pins the pair together.
 */

const rgb = (r: number, g: number, b: number): Swatch => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
});

describe("srgbToOklab / oklabToSrgb", () => {
  it("round-trips losslessly at 8-bit precision", () => {
    /*
     * The engine's identity guarantee depends on this. At zero intensity the
     * shader does nothing but convert to Oklab and back, and if that round trip
     * lost so much as a level then "does not modify the artwork" would be false
     * before a single module ran.
     */
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const source = rgb(r, g, b);
          const back = oklabToSrgb(srgbToOklab(source));

          expect(Math.abs(back.r * 255 - r)).toBeLessThan(0.5);
          expect(Math.abs(back.g * 255 - g)).toBeLessThan(0.5);
          expect(Math.abs(back.b * 255 - b)).toBeLessThan(0.5);
        }
      }
    }
  });

  it("puts greys on the neutral axis", () => {
    for (const level of [0, 64, 128, 200, 255]) {
      const { a, b } = srgbToOklab(rgb(level, level, level));
      expect(Math.abs(a)).toBeLessThan(1e-6);
      expect(Math.abs(b)).toBeLessThan(1e-6);
    }
  });

  it("orders lightness the way the eye does", () => {
    const dark = srgbToOklab(rgb(30, 30, 30)).L;
    const mid = srgbToOklab(rgb(128, 128, 128)).L;
    const light = srgbToOklab(rgb(230, 230, 230)).L;

    expect(dark).toBeLessThan(mid);
    expect(mid).toBeLessThan(light);
    // Mid grey lands near the middle of the lightness range, which is the whole
    // point of a perceptual space — in linear light it would sit near 0.2.
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.65);
  });

  it("holds lightness roughly constant across hues of equal luminance", () => {
    // What makes "move the colour without changing the brightness" possible.
    const hues = [rgb(220, 60, 60), rgb(60, 220, 60), rgb(60, 60, 220)];
    const lightness = hues.map((h) => srgbToOklab(h).L);

    // Not identical — these are not equiluminant in sRGB — but far closer than
    // a naive RGB average would put them.
    expect(Math.max(...lightness) - Math.min(...lightness)).toBeLessThan(0.35);
  });

  it("keeps a small step small in every direction", () => {
    /*
     * Perceptual uniformity is why the fidelity clamp can use one budget for
     * all colours. A fixed step in Oklab has to mean roughly the same visible
     * change whether it is applied to a dark blue or a bright yellow — in sRGB
     * it emphatically does not.
     */
    const step = 0.02;
    const samples = [rgb(20, 20, 60), rgb(240, 230, 90), rgb(120, 60, 30)];

    const distances = samples.map((sample) => {
      const lab = srgbToOklab(sample);
      const moved = oklabToSrgb({ ...lab, L: lab.L + step });
      return (
        Math.abs(moved.r - sample.r) +
        Math.abs(moved.g - sample.g) +
        Math.abs(moved.b - sample.b)
      );
    });

    // The largest response to the same step is within 4x the smallest. In sRGB
    // the equivalent spread is more than an order of magnitude.
    expect(Math.max(...distances) / Math.min(...distances)).toBeLessThan(4);
  });
});
