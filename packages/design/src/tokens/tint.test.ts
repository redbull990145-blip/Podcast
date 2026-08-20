import { describe, expect, it } from 'vitest';
import { dark, light } from './color.ts';
import {
  contrastRatio,
  deriveCover,
  deriveTint,
  hexToRgb,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
} from './tint.ts';

/** Real podcast covers are rarely well-behaved. These are the awkward ones. */
const COVERS = {
  vividOrange: '#FF6A00',
  deepBlue: '#0B2E6B',
  nearBlack: '#0A0A0B',
  blownWhite: '#FDFDFD',
  fluorescentLime: '#CCFF00',
  muddyBrown: '#5A4632',
  neutralGrey: '#808080',
  hotPink: '#FF1493',
};

describe('colour conversion', () => {
  it('round-trips hex through OKLab', () => {
    for (const hex of Object.values(COVERS)) {
      const back = rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex)!)));
      const original = hexToRgb(hex)!;
      const result = hexToRgb(back)!;

      // Within one 8-bit step per channel — the round trip is lossy only to
      // rounding, not to the maths.
      expect(Math.abs(result.r - original.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.g - original.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.b - original.b)).toBeLessThanOrEqual(1);
    }
  });

  it('parses hex with or without a leading hash', () => {
    expect(hexToRgb('#FF6A00')).toEqual(hexToRgb('FF6A00'));
  });

  it('rejects malformed input rather than producing a colour', () => {
    // A bad value from a publisher must not silently become black.
    for (const bad of ['', 'nope', '#FFF', '#GGGGGG', '#12345']) {
      expect(hexToRgb(bad)).toBeNull();
    }
  });
});

describe('deriveTint', () => {
  it('returns null for an unusable value instead of guessing', () => {
    expect(deriveTint('not-a-colour', 'dark')).toBeNull();
  });

  /**
   * The check that matters. Every tint is generated from artwork we do not
   * control, so legibility cannot be verified by eye per show — it has to hold
   * for every input by construction.
   */
  it('keeps tinted text readable on both themes, for every awkward cover', () => {
    for (const [name, hex] of Object.entries(COVERS)) {
      const onDark = deriveTint(hex, 'dark')!;
      const onLight = deriveTint(hex, 'light')!;

      expect(contrastRatio(onDark.text, dark.bg), `${name} on dark`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(onLight.text, light.bg), `${name} on light`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the ambient wash close to the app background', () => {
    // A page tinted by a hundred different covers must still feel like one
    // product. The wash is felt more than seen.
    for (const hex of Object.values(COVERS)) {
      const { wash } = deriveTint(hex, 'dark')!;
      expect(contrastRatio(wash, dark.bg)).toBeLessThan(2);
    }
  });

  it('preserves hue so a tint is recognisably that show’s', () => {
    const orange = rgbToOklab(hexToRgb(deriveTint(COVERS.vividOrange, 'dark')!.fill)!);
    const blue = rgbToOklab(hexToRgb(deriveTint(COVERS.deepBlue, 'dark')!.fill)!);

    // Orange sits on the warm side of the b axis, blue on the cool side.
    expect(orange.b).toBeGreaterThan(0);
    expect(blue.b).toBeLessThan(0);
  });

  it('lifts a near-black cover into a visible tint', () => {
    // Using the raw colour would produce an invisible wash on a dark ground.
    const { fill } = deriveTint(COVERS.nearBlack, 'dark')!;
    expect(contrastRatio(fill, dark.bg)).toBeGreaterThan(2);
  });

  it('tames a fluorescent cover instead of letting it shout', () => {
    const tamed = deriveTint(COVERS.fluorescentLime, 'dark')!;
    const rawContrast = contrastRatio(COVERS.fluorescentLime, dark.bg);
    expect(contrastRatio(tamed.wash, dark.bg)).toBeLessThan(rawContrast);
  });

  it('does not invent a hue for a grey cover', () => {
    // Scaling the noise in a neutral would give the show a colour its artwork
    // does not have.
    const { fill } = deriveTint(COVERS.neutralGrey, 'dark')!;
    const rgb = hexToRgb(fill)!;
    expect(Math.abs(rgb.r - rgb.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(rgb.g - rgb.b)).toBeLessThanOrEqual(2);
  });
});

describe('contrastRatio', () => {
  it('matches the known extremes', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#123456', '#FEDCBA')).toBeCloseTo(
      contrastRatio('#FEDCBA', '#123456'),
      5,
    );
  });

  it('confirms the app’s own body text clears AA', () => {
    expect(contrastRatio(dark.textPrimary, dark.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.textSecondary, dark.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.textPrimary, light.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.textSecondary, light.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * Category tiles carry a white label, and their colour comes from whichever
 * show the catalogue happened to file under that category — a range we do not
 * control any more than we control cover art. So the guarantee has to hold for
 * every hue, not for the four in the mock.
 */
describe('deriveCover', () => {
  const HUES = Array.from({ length: 24 }, (_, i) => {
    const hue = (i * 15 * Math.PI) / 180;
    // Full-chroma sRGB samples around the wheel, which is the worst case: a
    // saturated yellow is the colour most likely to be too luminous for white.
    const rgb = oklabToRgb({ L: 0.75, a: 0.16 * Math.cos(hue), b: 0.16 * Math.sin(hue) });
    return rgbToHex(rgb);
  });

  it.each(HUES)('keeps a white label readable on %s', (hex) => {
    const cover = deriveCover(hex);
    expect(cover).not.toBeNull();
    expect(contrastRatio('#FFFFFF', cover!.from)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#FFFFFF', cover!.to)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the two stops far enough apart to read as a gradient', () => {
    for (const hex of HUES) {
      const cover = deriveCover(hex)!;
      // Not a threshold plucked from the air: below about 1.25:1 between the
      // ends, the tile is a flat fill that cost a gradient's worth of paint.
      expect(contrastRatio(cover.from, cover.to)).toBeGreaterThanOrEqual(1.25);
    }
  });

  it('returns nothing for a colour it cannot read', () => {
    expect(deriveCover('not a colour')).toBeNull();
  });
});
