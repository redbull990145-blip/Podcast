/**
 * Which colour a cover *is*.
 *
 * The sibling file pins the security properties of fetching artwork. This one
 * pins the judgement: given the handful of colours a quantiser found in a
 * cover, which one does the product wear? That decision has no single right
 * answer, so the tests are written as the rules it has to obey rather than as
 * expected hexes — the rules are what would be quietly broken by a tweak to
 * the scoring weights, and a hardcoded hex would just get updated to match.
 *
 * Hue is compared with a tolerance in OKLab rather than by equality, so the
 * assertions survive a change of quantiser but still fail if the extractor
 * starts naming a different colour.
 */

import { hexToRgb, rgbToOklab } from '@cue/design';
import { Swatch, type Palette } from '@vibrant/color';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extractArtworkColor, pickAccent } from './artwork-color.ts';

/** Build a palette from the swatches a case cares about; the rest are absent. */
function palette(entries: Record<string, [hex: string, population: number]>): Palette {
  const empty: Palette = {
    Vibrant: null,
    Muted: null,
    DarkVibrant: null,
    DarkMuted: null,
    LightVibrant: null,
    LightMuted: null,
  };

  for (const [name, [hex, population]] of Object.entries(entries)) {
    const rgb = hexToRgb(hex);
    if (!rgb) throw new Error(`bad fixture hex: ${hex}`);
    empty[name] = new Swatch([rgb.r, rgb.g, rgb.b], population);
  }

  return empty;
}

/** Hue angle in OKLab, in degrees. */
function hueOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`not a colour: ${hex}`);
  const lab = rgbToOklab(rgb);
  return (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
}

function chromaOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) throw new Error(`not a colour: ${hex}`);
  const lab = rgbToOklab(rgb);
  return Math.hypot(lab.a, lab.b);
}

/** Shortest angular distance, so 179° and -179° are 2° apart. */
function hueDistance(a: string, b: string): number {
  const delta = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return delta > 180 ? 360 - delta : delta;
}

describe('pickAccent', () => {
  it('names the small saturated region, not the large dull one', () => {
    // The case the whole module exists for: a cover that is mostly near-black
    // with an orange mark on it is an orange cover, not a black one.
    const picked = pickAccent(
      palette({
        DarkMuted: ['#141414', 9000],
        Vibrant: ['#E85D2A', 1000],
      }),
    );

    expect(picked).not.toBeNull();
    expect(hueDistance(picked!, '#E85D2A')).toBeLessThan(10);
  });

  it('keeps a large field over a tiny hyper-saturated speck', () => {
    // The other direction, and the failure mode of ranking on colourfulness
    // alone: a few pixels of pure magenta must not repaint a teal cover.
    const picked = pickAccent(
      palette({
        Muted: ['#2E8B84', 20_000],
        Vibrant: ['#FF00E6', 60],
      }),
    );

    expect(picked).not.toBeNull();
    expect(hueDistance(picked!, '#2E8B84')).toBeLessThan(15);
  });

  it('returns null for a greyscale cover rather than inventing a hue', () => {
    expect(
      pickAccent(
        palette({
          LightMuted: ['#D6D6D6', 4000],
          Muted: ['#8A8A8A', 5000],
          DarkMuted: ['#2B2B2B', 6000],
        }),
      ),
    ).toBeNull();
  });

  it('returns null when the quantiser found nothing', () => {
    expect(pickAccent(palette({}))).toBeNull();
  });

  it('returns a swatch colour verbatim, never a blend', () => {
    // Averaging is what the previous implementation did, and it is why a
    // two-tone cover used to come out muddy. Red and green must yield one of
    // them, not the brown between them.
    const picked = pickAccent(
      palette({
        Vibrant: ['#D92B2B', 5000],
        DarkVibrant: ['#1F8B3A', 5000],
      }),
    );

    expect(['#D92B2B', '#1F8B3A']).toContain(picked);
  });

  it('prefers the stable mid-lightness swatch over a near-black one', () => {
    // Hue read off something almost black is a couple of quantisation steps
    // from being a different hue, so it loses to an equally chromatic colour
    // sitting where the reading is trustworthy.
    const picked = pickAccent(
      palette({
        DarkVibrant: ['#0B0420', 8000],
        Vibrant: ['#5B7FD4', 8000],
      }),
    );

    expect(picked).toBe('#5B7FD4');
  });

  it('always answers with an uppercase #RRGGBB or null', () => {
    const picked = pickAccent(palette({ Vibrant: ['#e85d2a', 1000] }));
    expect(picked).toMatch(/^#[0-9A-F]{6}$/);
  });
});

/** A PNG that is `background` with a `patch`-coloured block over one corner. */
async function cover(background: string, patch: string | null): Promise<Buffer> {
  const base = sharp({
    create: { width: 200, height: 200, channels: 3, background },
  });

  if (!patch) return base.png().toBuffer();

  const block = await sharp({
    create: { width: 64, height: 64, channels: 3, background: patch },
  })
    .png()
    .toBuffer();

  return base
    .composite([{ input: block, top: 20, left: 20 }])
    .png()
    .toBuffer();
}

const asFetch = (fn: () => Promise<Response>) => fn as unknown as typeof fetch;

/** Serve a fixture from an address the SSRF guard allows. */
async function extractFrom(image: Buffer): Promise<string | null> {
  return extractArtworkColor('http://198.51.100.10/cover.png', {
    fetchImpl: asFetch(
      async () =>
        new Response(image, { status: 200, headers: { 'content-type': 'image/png' } }),
    ),
  });
}

describe('extractArtworkColor end to end', () => {
  it('finds the accent on a mostly-dark cover', async () => {
    // 90% near-black, 10% orange — the shape of a very large number of real
    // podcast covers, and the one the old bucket-averaging read as brown.
    const color = await extractFrom(await cover('#101010', '#E85D2A'));

    expect(color).not.toBeNull();
    expect(hueDistance(color!, '#E85D2A')).toBeLessThan(20);
  });

  it('keeps the chroma of the artwork instead of averaging it away', async () => {
    const color = await extractFrom(await cover('#101010', '#E85D2A'));

    expect(color).not.toBeNull();
    // The source orange sits around 0.15 in OKLab. Averaging it against a
    // near-black field is what used to drag the answer toward neutral.
    expect(chromaOf(color!)).toBeGreaterThan(0.08);
  });

  it('reads a cover whose colour is the background, not the subject', async () => {
    const color = await extractFrom(await cover('#2F5FD0', '#EFEFEF'));

    expect(color).not.toBeNull();
    expect(hueDistance(color!, '#2F5FD0')).toBeLessThan(20);
  });

  it('returns null for a genuinely greyscale cover', async () => {
    expect(await extractFrom(await cover('#3A3A3A', '#C8C8C8'))).toBeNull();
  });

  it('returns null for bytes that are not an image', async () => {
    expect(await extractFrom(Buffer.from('this is not a png'))).toBeNull();
  });
});
