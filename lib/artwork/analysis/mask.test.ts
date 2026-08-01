import { describe, expect, it } from "vitest";
import { analyseArtwork } from "./analyse";
import { buildProtectionMask, MASK_SIZE } from "./mask";

/**
 * The mask is what makes "never distort text, logos or typography" a property
 * of the arithmetic rather than a promise. Every displacing term in the shader
 * is multiplied by `1 - protect`, so these tests are the ones standing between
 * the engine and a smeared glyph.
 */

const SIZE = 64;

function cover(
  paint: (x: number, y: number) => [number, number, number],
  size = SIZE,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Reads the mask at normalised coordinates, 0–1. */
function at(mask: Uint8Array, x: number, y: number): number {
  const mx = Math.min(MASK_SIZE - 1, Math.floor(x * MASK_SIZE));
  const my = Math.min(MASK_SIZE - 1, Math.floor(y * MASK_SIZE));
  return mask[my * MASK_SIZE + mx] / 255;
}

describe("buildProtectionMask", () => {
  it("leaves a featureless cover entirely free to move", () => {
    const mask = buildProtectionMask(
      new Float32Array(SIZE * SIZE),
      SIZE,
      new Float32Array(0),
      0,
      null,
    );

    expect(mask).toHaveLength(MASK_SIZE * MASK_SIZE);
    expect(Math.max(...mask)).toBe(0);
  });

  it("protects a strong gradient completely", () => {
    const edges = new Float32Array(SIZE * SIZE).fill(0.9);
    const mask = buildProtectionMask(edges, SIZE, new Float32Array(0), 0, null);
    expect(Math.min(...mask)).toBe(255);
  });

  it("ignores the noise floor of a photograph", () => {
    // Gradients this weak are grain, not features. Protecting them would freeze
    // every photographic cover in the library.
    const edges = new Float32Array(SIZE * SIZE).fill(0.06);
    const mask = buildProtectionMask(edges, SIZE, new Float32Array(0), 0, null);
    expect(Math.max(...mask)).toBe(0);
  });

  it("keeps a single stroke rather than averaging it away", () => {
    // One isolated strong pixel per downsample patch. Averaging would reduce it
    // to a sixteenth of its strength and leave the glyph it belongs to
    // unprotected; taking the maximum is what preserves it.
    const edges = new Float32Array(SIZE * SIZE);
    edges[33 * SIZE + 33] = 1;

    const mask = buildProtectionMask(edges, SIZE, new Float32Array(0), 0, null);
    expect(at(mask, 33 / SIZE, 33 / SIZE)).toBeGreaterThan(0.9);
  });

  it("puts a margin around what it protects", () => {
    // Displacing a pixel next to a glyph still smears its antialiased edge, so
    // the mask has to be wider than the feature.
    const edges = new Float32Array(SIZE * SIZE);
    edges[32 * SIZE + 32] = 1;

    const mask = buildProtectionMask(edges, SIZE, new Float32Array(0), 0, null);
    const centre = 32 / SIZE;
    const oneCell = 1 / MASK_SIZE;

    expect(at(mask, centre + oneCell * 1.5, centre)).toBeGreaterThan(0.15);
    // But not the whole cover — over-protection is safe, total protection is
    // just a static image.
    expect(at(mask, 0.95, 0.95)).toBe(0);
  });

  it("has no hard boundary between moving and still", () => {
    // A step in the mask is a step in the motion field, and the eye finds an
    // axis-aligned edge in organic movement instantly. Neighbouring cells must
    // never jump the full range.
    const edges = new Float32Array(SIZE * SIZE);
    for (let y = 20; y < 44; y += 1) {
      for (let x = 20; x < 44; x += 1) edges[y * SIZE + x] = 1;
    }

    const mask = buildProtectionMask(edges, SIZE, new Float32Array(0), 0, null);

    let biggestJump = 0;
    for (let y = 0; y < MASK_SIZE; y += 1) {
      for (let x = 1; x < MASK_SIZE; x += 1) {
        const jump = Math.abs(mask[y * MASK_SIZE + x] - mask[y * MASK_SIZE + x - 1]);
        if (jump > biggestJump) biggestJump = jump;
      }
    }

    expect(biggestJump).toBeLessThan(180);
  });

  it("protects the gaps inside a word, not only its strokes", () => {
    // The background between two strokes has no gradient of its own. Moving the
    // gaps while the ink stays put is worse than moving neither, so the text
    // field has to extend protection across the whole block.
    const textGrid = 8;
    const textField = new Float32Array(textGrid * textGrid);
    textField[2 * textGrid + 2] = 0.5;

    const mask = buildProtectionMask(
      new Float32Array(SIZE * SIZE),
      SIZE,
      textField,
      textGrid,
      null,
    );

    expect(at(mask, 2.5 / textGrid, 2.5 / textGrid)).toBeGreaterThan(0.8);
  });

  it("freezes a detected face and fades out rather than ringing it", () => {
    const mask = buildProtectionMask(
      new Float32Array(SIZE * SIZE),
      SIZE,
      new Float32Array(0),
      0,
      { x: 0.5, y: 0.45, radius: 0.25 },
    );

    expect(at(mask, 0.5, 0.45)).toBe(1);
    // Beyond the radius, free.
    expect(at(mask, 0.5, 0.9)).toBe(0);
    // In between, partial — a hard circle would draw a visible ring on the art.
    expect(at(mask, 0.5, 0.24)).toBeGreaterThan(0);
    expect(at(mask, 0.5, 0.24)).toBeLessThan(1);
  });
});

describe("mask through the full pipeline", () => {
  const typography = cover((x, y) =>
    y % 32 < 16 && x % 6 < 2 ? [30, 28, 32] : [232, 230, 226],
  );

  const smooth = cover((_x, y) => {
    const v = Math.round(60 + (y / SIZE) * 60);
    return [v, v - 6, v - 14];
  });

  it("freezes every line of type", () => {
    // Measured over the rows that actually carry type rather than over the
    // whole cover. The leading between lines is flat white, and displacing flat
    // white produces no visible change at all — demanding the mask cover it too
    // would be testing for protection that protects nothing.
    const { mask } = analyseArtwork(typography);

    let lowest = 255;
    for (let y = 0; y < MASK_SIZE; y += 1) {
      if (y % 32 >= 16) continue;
      for (let x = 0; x < MASK_SIZE; x += 1) {
        lowest = Math.min(lowest, mask[y * MASK_SIZE + x]);
      }
    }

    expect(lowest).toBeGreaterThan(230);
  });

  it("leaves a smooth cover free to move", () => {
    const { mask } = analyseArtwork(smooth);
    const frozen = [...mask].filter((v) => v > 128).length;
    expect(frozen / mask.length).toBeLessThan(0.05);
  });

  it("produces a mask of the declared size and range", () => {
    const { mask, maskSize } = analyseArtwork(typography);
    expect(maskSize).toBe(MASK_SIZE);
    expect(mask).toHaveLength(MASK_SIZE * MASK_SIZE);
    expect(mask.every((v) => v >= 0 && v <= 255)).toBe(true);
  });
});
