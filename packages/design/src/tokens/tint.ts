/**
 * Artwork-derived colour.
 *
 * The design's colour strategy: the chrome stays near-neutral warm paper and the
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

import { dark, light, stage, type ColorScheme } from './color.ts';

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

/**
 * Status colours for a tinted *light* page.
 *
 * The mirror of the dark branch borrowing from `stage`, and for the identical
 * reason. `status.*Light` are fitted against paper and have no headroom left —
 * the note beside them in `color.ts` records that two of them were already
 * sitting at 4.47 and 4.49:1 before being corrected. A tinted surface moves the
 * ground by a fraction of a step, which is all it takes to put them back under:
 * `warning` on an ember-tinted page landed at 4.4991:1, a failure invisible to
 * everything except the assertion that caught it.
 *
 * These three hues are dark enough for the richer light-theme grounds (the
 * darkest is now L .88). There is nowhere to borrow them from — there
 * is no light `stage` — and deriving them from the cover would be wrong, since
 * "this failed" must not change colour with the artwork.
 */
const STATUS_ON_TINTED_PAPER = {
  danger: '#8D171C',
  success: '#185428',
  warning: '#663708',
} as const;

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
      /*
        Barely above the near-black ground: felt more than seen — and the
        "barely" is a contrast budget, not a mood.

        This is a ground the *page's own* text lands on: Library paints it
        behind a whole row, the episode header paints it as a band under the
        title and date. Those roles were fitted against `bg`, so every step the
        wash takes away from `bg` is contrast spent. At 0.26 it had spent
        enough to put `textTertiary` at 4.43–4.49:1 — under AA for every cover
        tried, by a margin small enough that nobody would ever see it and a
        checker would always catch it.
      */
      wash: rgbToHex(oklabToRgb(refit(lab, 0.24, 0.05))),
      fill: rgbToHex(oklabToRgb(refit(lab, 0.62, 0.12))),
      // Light enough to clear 4.5:1 on the dark background.
      text: rgbToHex(oklabToRgb(refit(lab, 0.8, 0.11))),
    };
  }

  return {
    /*
      Same budget, from the other end: the light ground is `#FBFAF7`, so here
      the wash has to stay *up* near white rather than down near black.

      0.967 rather than a rounder 0.96 because of ember specifically. OKLab
      lightness is perceptual and luminance is not, so a warm orange at a given
      L carries measurably less luminance than a neutral at the same L — and
      ember is both the app's own accent and a very common cover colour, so it
      is the one hue guaranteed to be exercised. At 0.96 it landed at 4.49:1.
    */
    wash: rgbToHex(oklabToRgb(refit(lab, 0.967, 0.04))),
    fill: rgbToHex(oklabToRgb(refit(lab, 0.62, 0.12))),
    // Dark enough to clear 4.5:1 on white.
    text: rgbToHex(oklabToRgb(refit(lab, 0.45, 0.11))),
  };
}


/**
 * A whole palette, taken from one cover.
 *
 * `deriveTint` colours a *band* — a wash behind a header, a fill on a chip.
 * This colours a **page**: Apple Music's album view, where opening a record
 * repaints the window in that record's colour and switching records repaints it
 * again. A gradient that fades out 300px down is a decoration; a ground that
 * runs to the bottom of the scroll is the show's own room.
 *
 * Three rules make it work rather than look like a skin.
 *
 * **Darkened, always.** The extracted colour is the *loudest* thing in the
 * artwork — that is how dominant-colour extraction works — so painting the page
 * in it puts the cover on a ground of its own brightest region and the two
 * fight. Every surface here is refit to a low OKLab lightness, so the artwork is
 * the brightest object on its own page by construction, whatever it contains.
 *
 * **Chroma is capped hard.** A page at the cover's real saturation is a themed
 * skin; at a tenth of it, it is a room the cover is lit in. The cap is also what
 * keeps forty different shows feeling like one product.
 *
 * **The foreground does not move.** Only grounds and the accent take the hue —
 * text stays a fixed neutral white ramp, so legibility is a property of the
 * function rather than of which cover happened to be passed in. That is the same
 * reasoning as `stage`, for the same reason: the input is a publisher's JPEG.
 *
 * Returns `null` for a colour it cannot parse, and the caller falls back to the
 * ordinary theme — an untinted page is a perfectly good page.
 *
 * **Both themes, because a tinted page is still the listener's app.** This used
 * to return a dark palette unconditionally, on the reasoning that artwork sits
 * better on a dark ground — true, and not the function's call to make. The
 * result was that every podcast page, every episode page and the resume hero
 * repainted the whole window dark for somebody who had chosen the light theme,
 * rail and tab bar included, because `ChromeTint` pushes this onto the chrome
 * too. Choosing Light and then opening a show was indistinguishable from the
 * setting not having been saved.
 *
 * The three rules in the doc above are what survive the flip: the ground is
 * still refit away from the cover's own lightness (up towards paper here rather
 * than down towards black), chroma is bounded, and the text
 * ramp is still a fixed neutral rather than a tinted one — so legibility stays
 * a property of the function whichever theme it is asked for.
 */
export function tintedScheme(
  hex: string,
  /**
   * Defaulted, and defaulted to the old behaviour on purpose: three call sites
   * and a table of contrast tests already ask for a tinted page without saying
   * which theme they are on, and dark is what they have always meant.
   */
  theme: 'dark' | 'light' = 'dark',
): ColorScheme | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const lab = rgbToOklab(rgb);
  const at = (L: number, chroma: number) => rgbToHex(oklabToRgb(refit(lab, L, chroma)));

  if (theme === 'light') {
    /*
      The same construction from the other end.

      `light`'s own surfaces get *darker* as they recede — a card on paper is a
      recess, not a glare — so the tint follows that ordering rather than
      inverting the dark ramp, which would have raised every panel towards white
      and produced the spreadsheet look the light theme was designed away from.

      A full-page palette has its own foreground ramp, so it can keep more hue
      than a small wash behind ordinary light-theme text. Lowering the ground
      from near-white gives chroma room without washing the artwork color out.
    */
    return {
      ...light,

      // Give the hue room below white: at L .975 most saturated hues clip
      // into pastel white. These grounds stay light while retaining color.
      bg: at(0.91, 0.065),
      surface: at(0.88, 0.07),
      surfaceRaised: at(0.945, 0.045),
      surfaceOverlay: at(0.945, 0.045),
      // Neutral overlays, as in `light`. A tinted hover on a tinted surface is
      // two washes of the same hue and reads as a rendering artefact.
      surfaceHover: 'rgba(23, 21, 18, 0.05)',
      surfacePressed: 'rgba(23, 21, 18, 0.08)',

      border: at(0.8, 0.065),
      borderStrong: 'rgba(23, 21, 18, 0.6)',

      // Fixed and neutral, exactly as the dark branch fixes white — see the
      // third rule above. A hue-carrying near-black on a hue-carrying near-white
      // is where tinted palettes go wrong.
      textPrimary: '#171512',
      textSecondary: 'rgba(23, 21, 18, 0.82)',
      textTertiary: 'rgba(23, 21, 18, 0.72)',

      // The accent takes the hue and has to be dark enough to read *on* paper,
      // which is the mirror of the dark branch lightening it to clear near-black.
      accent: at(0.48, 0.13),
      accentText: at(0.38, 0.12),
      accentMuted: 'rgba(23, 21, 18, 0.08)',
      textOnAccent: at(0.98, 0.02),

      ink: '#171512',
      textOnInk: at(0.98, 0.02),

      ...STATUS_ON_TINTED_PAPER,

      skeleton: at(0.83, 0.06),
    };
  }

  /*
    For a neutral, OKLab's L is the cube root of relative luminance — so
    L = 0.30 is Y ≈ 0.027, and white on it clears 13:1. The chroma ceilings are
    low enough that a hue's own luminance cannot move that far. Every pair below
    is checked in `contrast.test.ts` against a spread of real cover colours
    rather than argued for here.
  */
  return {
    ...dark,

    bg: at(0.22, 0.045),
    surface: at(0.26, 0.05),
    surfaceRaised: at(0.3, 0.05),
    surfaceOverlay: at(0.3, 0.05),
    surfaceHover: 'rgba(255, 255, 255, 0.08)',
    surfacePressed: 'rgba(255, 255, 255, 0.13)',

    border: at(0.35, 0.045),
    borderStrong: 'rgba(255, 255, 255, 0.45)',

    // Neutral, and neutral on purpose — see above. A warm cream on a cool
    // cover's page is the tell that a palette was tinted rather than designed.
    textPrimary: '#FFFFFF',
    textSecondary: 'rgba(255, 255, 255, 0.76)',
    textTertiary: 'rgba(255, 255, 255, 0.62)',

    // The one foreground that *does* take the hue, because on a page this
    // saturated the ember accent would be a second, unrelated colour.
    accent: at(0.74, 0.13),
    accentText: at(0.86, 0.1),
    accentMuted: 'rgba(255, 255, 255, 0.14)',
    textOnAccent: at(0.18, 0.05),

    ink: '#FFFFFF',
    textOnInk: at(0.18, 0.05),

    /*
      Borrowed from `stage`, not from `dark`, and the tests are the reason.

      `dark`'s status colours were fitted against a ground that is fixed and
      very dark. These surfaces are lighter — they have to be, or a tinted page
      has no colour in it — and `danger` landed at 4.1–4.3:1 on the raised one
      for every cover tried. `stage` already solved the identical problem for
      the identical reason, so this points at that answer rather than inventing
      a third set of three constants to keep in sync.
    */
    danger: stage.danger,
    success: stage.success,
    warning: stage.warning,

    skeleton: at(0.26, 0.05),
  };
}

/**
 * A gradient for a surface that has no artwork of its own.
 *
 * Category tiles, mainly: a category is a set of shows, and the only honest
 * colour it can have is one borrowed from something inside it. Two stops of
 * the same hue at different lightness, which is what makes a flat rectangle
 * read as a surface rather than a swatch.
 *
 * **Both stops are dark enough for a white label, by construction.** That is
 * the whole reason this is a function and not two `refit` calls at the call
 * site. A fixed lightness cannot promise it: OKLab's L is perceptual, and at
 * one L a yellow is far more *luminous* than a blue — so a pair that clears AA
 * for a navy category fails for a mustard one, silently, on whichever tile
 * happens to exist in the catalogue that week. Darkening until it measures
 * clear costs a handful of iterations once per tile and cannot be wrong.
 */
export function deriveCover(hex: string): { from: string; to: string } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const lab = rgbToOklab(rgb);
  const from = darkenUntilLegible(lab, 0.52);

  return {
    from,
    // The far stop is a fixed step below the near one rather than an absolute
    // lightness, so the gradient keeps the same depth whether the hue needed
    // darkening or not. A tile whose two ends drift together is a flat fill
    // that took a gradient's worth of work.
    to: rgbToHex(oklabToRgb(refit(lab, labLightness(from) - 0.18, COVER_CHROMA))),
  };
}

/** Muted: a wall of tiles at full chroma is a paint chart, not a catalogue. */
const COVER_CHROMA = 0.085;

/** White on the tile, as the label is drawn. */
const LABEL = '#FFFFFF';

function labLightness(hex: string): number {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToOklab(rgb).L : 0.5;
}

function darkenUntilLegible(lab: Oklab, startL: number): string {
  let L = startL;

  // Bounded rather than `while (true)`: at L = 0.2 every hue in the sRGB gamut
  // clears 4.5:1 against white, so the loop is guaranteed to exit long before
  // this — the cap is here so that a future change to the constants cannot
  // turn a colour helper into a hang.
  for (let step = 0; step < 12; step += 1) {
    const candidate = rgbToHex(oklabToRgb(refit(lab, L, COVER_CHROMA)));
    if (contrastRatio(LABEL, candidate) >= 4.5) return candidate;
    L -= 0.03;
  }

  return rgbToHex(oklabToRgb(refit(lab, 0.2, COVER_CHROMA)));
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
