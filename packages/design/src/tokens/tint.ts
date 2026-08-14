/**
 * Artwork-derived colour.
 *
 * The design's colour strategy: the chrome stays near-neutral graphite and the
 * *artwork* supplies the colour. This is how Apple Music and Spotify feel
 * colourful without being loud — the palette changes per show, so the product
 * reads as full of colour while never inventing a colour of its own.
 *
 * A raw dominant colour cannot be used directly. Podcast covers are frequently
 * near-black, blown-out white, or a fluorescent that would obliterate text laid
 * over it. So the extracted hue is kept and its lightness and chroma are
 * re-fitted to the surface it will sit on.
 *
 * The maths runs through OKLab because it is perceptually uniform: holding
 * "lightness" fixed in sRGB makes yellows fluoresce and blues disappear, and
 * that inconsistency is exactly what makes a tinted UI look accidental.
 */

export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;

  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).padStart(6, '0').toUpperCase()}`;
}

// -------------------------------------------------------------- OKLab ------

const toLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (channel: number): number => {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return c * 255;
};

type Oklab = { L: number; a: number; b: number };

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** Chroma is the distance from the neutral axis; hue is the angle. */
function chromaOf({ a, b }: Oklab): number {
  return Math.hypot(a, b);
}

/**
 * Re-fit a colour to a target lightness and a chroma ceiling, keeping its hue.
 *
 * Hue is the only part of an artwork's colour worth preserving — it is what
 * makes the tint recognisably *that show's*. Lightness and chroma belong to
 * the surface, so text on top stays legible whatever the cover looks like.
 */
function refit(lab: Oklab, targetL: number, maxChroma: number): Oklab {
  const chroma = chromaOf(lab);

  // A near-grey cover has no meaningful hue to preserve; scaling its noise up
  // would invent a colour the artwork does not have.
  if (chroma < 0.02) return { L: targetL, a: 0, b: 0 };

  const scale = Math.min(1, maxChroma / chroma);
  return { L: targetL, a: lab.a * scale, b: lab.b * scale };
}

export type TintSet = {
  /** Ambient wash behind a header. Sits just above the app background. */
  wash: string;
  /** A stronger fill: a chip, a progress bar, a selected row. */
  fill: string;
  /** The hue as text or an icon, contrast-fitted to the theme's background. */
  text: string;
};

/**
 * Derive the usable tints for one artwork colour.
 *
 * Deliberately conservative: `wash` sits close enough to the app background
 * that a page tinted by a hundred different covers still feels like one
 * product, rather than a hundred differently-coloured pages.
 */
export function deriveTint(hex: string, theme: 'dark' | 'light'): TintSet | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const lab = rgbToOklab(rgb);

  if (theme === 'dark') {
    return {
      // Barely above the near-black ground: felt more than seen.
      wash: rgbToHex(oklabToRgb(refit(lab, 0.26, 0.055))),
      fill: rgbToHex(oklabToRgb(refit(lab, 0.62, 0.12))),
      // Light enough to clear 4.5:1 on the dark background.
      text: rgbToHex(oklabToRgb(refit(lab, 0.8, 0.11))),
    };
  }

  return {
    wash: rgbToHex(oklabToRgb(refit(lab, 0.95, 0.045))),
    fill: rgbToHex(oklabToRgb(refit(lab, 0.62, 0.12))),
    // Dark enough to clear 4.5:1 on white.
    text: rgbToHex(oklabToRgb(refit(lab, 0.45, 0.11))),
  };
}

/**
 * Relative luminance and contrast, so the tint maths can be *tested* against
 * WCAG rather than eyeballed.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return 1;

  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);

  return (lighter + 0.05) / (darker + 0.05);
}
