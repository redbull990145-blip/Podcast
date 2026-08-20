import { describe, expect, it } from 'vitest';
import { colorSchemes, dark, light, onyx, stage, type ColorScheme } from './color.ts';
import { tintVars } from '../css.ts';
import {
  contrastRatio,
  deriveTint,
  hexToRgb,
  relativeLuminance,
  tintedScheme,
} from './tint.ts';

/**
 * WCAG 2.2 AA, as a test rather than an intention.
 *
 * The tint tests already do this for colours derived from artwork, on the
 * grounds that the inputs are covers we do not control. This file does it for
 * the palette we *do* control, which needs it for the opposite reason: a token
 * is edited by hand, once, and silently changes the contrast of every screen
 * that uses it. Checking four pairs by hand — which is what this replaced —
 * left `textTertiary` below the threshold on every surface in both themes.
 *
 * 4.5:1 rather than the 3:1 large-text allowance, because these roles are worn
 * by captions, timestamps and metadata. The allowance only applies from 24px,
 * or 18.66px bold, and nothing in the type scale wearing these roles is that
 * large.
 */

const AA_NORMAL_TEXT = 4.5;
/** SC 1.4.11: interface components and their states. */
const AA_NON_TEXT = 3;

/**
 * Every surface text can land on.
 *
 * `surfaceHover` and `surfacePressed` are excluded because they are
 * translucent overlays rather than grounds — what sits behind them is one of
 * these, and compositing them here would test a colour that never exists.
 */
const SURFACES = ['bg', 'surface', 'surfaceRaised', 'surfaceOverlay'] as const;

/** Roles that carry words. */
const TEXT_ROLES = [
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'accentText',
  'danger',
  'success',
  'warning',
] as const;

describe.each(Object.entries(colorSchemes))('%s scheme', (_name, scheme: ColorScheme) => {
  describe.each(TEXT_ROLES)('%s', (role) => {
    it.each(SURFACES)(`clears AA on %s`, (surface) => {
      expect(contrastRatio(scheme[role], scheme[surface])).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    });
  });

  it('keeps a label on the accent readable', () => {
    // The primary button. It was 3.44:1 in light mode, which is a fail for the
    // single most-pressed control in the product.
    expect(contrastRatio(scheme.textOnAccent, scheme.accent)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it('keeps a label on the ink fill readable', () => {
    // The other primary control. `ink` carries Resume, Follow and every filled
    // pill, and it is the one pair in the palette that inverts between themes —
    // exactly the shape of thing that gets edited on one side only.
    expect(contrastRatio(scheme.textOnInk, scheme.ink)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it('keeps the accent itself distinguishable as a control', () => {
    // Non-text: the accent marks the playing state and the focus ring, so it
    // has to be visible against the ground even when it carries no label.
    expect(contrastRatio(scheme.accent, scheme.bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('keeps the strong border visible where it separates controls', () => {
    // `borderStrong` outlines inputs and secondary buttons — a boundary you
    // cannot see is not a boundary. `border` is exempt: it is decorative
    // hairline separation, not a control edge.
    expect(contrastRatio(flatten(scheme.borderStrong, scheme.bg), scheme.bg)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });
});

/**
 * The two schemes nobody selects.
 *
 * `stage` and `tintedScheme` are not in `colorSchemes` — one belongs to a single
 * screen and the other is generated per cover — so the loop above never reaches
 * them, and they are the two that need checking most. Both paint text over a
 * ground chosen by a publisher's JPEG rather than by us.
 *
 * The cover colours below are picked to be awkward on purpose: the near-black
 * and blown-white ones are where a "darken it a bit" rule quietly does nothing,
 * and yellow is where OKLab lightness and actual luminance diverge furthest —
 * a palette that clears AA for navy and fails for mustard fails silently, on
 * whichever show happens to exist in the catalogue that week.
 */
const COVER_COLOURS = [
  ['ember', '#F0724A'],
  ['navy', '#1B2A6B'],
  ['mustard', '#F2C200'],
  ['near-black', '#0B0B0C'],
  ['blown-white', '#FBFBF9'],
  ['magenta', '#D400A1'],
  ['forest', '#0E4D2A'],
  ['cyan', '#00D4E6'],
] as const;

const UNCHOSEN: [string, ColorScheme][] = [
  ['stage', stage],
  ...COVER_COLOURS.map(
    ([name, hex]): [string, ColorScheme] => [`tinted by ${name}`, tintedScheme(hex)!],
  ),
];

describe.each(UNCHOSEN)('%s', (_name, scheme) => {
  it.each(TEXT_ROLES.filter((role) => role !== 'accentText'))(
    '%s clears AA on every surface',
    (role) => {
      for (const surface of SURFACES) {
        expect(
          contrastRatio(flatten(scheme[role], scheme[surface]), scheme[surface]),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    },
  );

  /**
   * The accent is hue-carrying here rather than neutral, so it gets its own
   * case: on a tinted page it is the *cover's* colour lightened, and the whole
   * point of capping chroma and fixing lightness is that this holds for a
   * fluorescent cyan as well as for a navy.
   */
  it('keeps the accent readable as text on every surface', () => {
    for (const surface of SURFACES) {
      expect(contrastRatio(scheme.accentText, scheme[surface])).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    }
  });

  it('keeps labels on the accent and ink fills readable', () => {
    expect(contrastRatio(scheme.textOnAccent, scheme.accent)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
    expect(contrastRatio(scheme.textOnInk, scheme.ink)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it('keeps the strong border visible as a control edge', () => {
    expect(
      contrastRatio(flatten(scheme.borderStrong, scheme.bg), scheme.bg),
    ).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

/**
 * `deriveTint`'s two fits, against the grounds each one claims to be for.
 *
 * The variant argument is the whole contract of this function and nothing was
 * checking it. Four screens took the dark fit — `text` at OKLab L 0.80, sized to
 * clear near-black — and painted it straight onto the light theme's `#FBFAF7`
 * page, where it is light-on-light. It looked correct to everyone who built it,
 * because everyone who built it was in the dark theme.
 *
 * So both directions are pinned here: each fit clears AA on every ground of the
 * theme it names, for every awkward cover colour in the list. A future call site
 * can still point the wrong fit at the wrong ground, but the *values* can no
 * longer drift underneath one that got it right.
 */
describe('deriveTint', () => {
  /** The dark fit has two grounds to survive now, not one. */
  const DARK_GROUNDS = [dark, onyx] as const;

  describe.each(COVER_COLOURS)('%s', (_name, hex) => {
    it('reads as text on every dark surface', () => {
      for (const scheme of DARK_GROUNDS) {
        for (const surface of SURFACES) {
          expect(
            contrastRatio(deriveTint(hex, 'dark')!.text, scheme[surface]),
          ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
      }
    });

    it('reads as text on every light surface', () => {
      for (const surface of SURFACES) {
        expect(
          contrastRatio(deriveTint(hex, 'light')!.text, light[surface]),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    });

    /**
     * The wash is a *ground* on the ordinary page, not a surface of its own.
     *
     * Library paints it behind a whole row and the episode header paints it as
     * a band across the top, and in both cases the text on top is still the
     * theme's — so every role that lands there has to clear AA against it, in
     * the theme the wash was fitted for. Hovering a Library row used to drop
     * the *dark* wash behind near-black light-theme text and erase the row
     * under the cursor; the episode header did the same to its date line.
     *
     * All three text roles, not just `textPrimary`. Primary is the one with
     * contrast to spare, so checking it alone would have passed while the date
     * under an episode title sat at 2.96:1 — which is exactly what shipped.
     *
     * Status colours are excluded, and that is a scope decision rather than an
     * oversight: nothing puts an error, a warning or a success message on a
     * washed row or header, and holding the wash to `danger` — the darkest
     * thing in either palette — would cost roughly another third of the wash's
     * visible strength to protect a combination that does not occur. If one
     * ever does, this list is where to say so.
     */
    it.each(['textPrimary', 'textSecondary', 'textTertiary'] as const)(
      'holds the theme’s own %s when used as a ground',
      (role) => {
        for (const scheme of DARK_GROUNDS) {
          expect(
            contrastRatio(scheme[role], deriveTint(hex, 'dark')!.wash),
          ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }

        expect(
          contrastRatio(light[role], deriveTint(hex, 'light')!.wash),
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      },
    );

    /**
     * And the self-contained pairing: the Library badge is `text` on `wash`
     * from the same fit, which is why it was never part of the bug above.
     */
    it('pairs its own text and wash', () => {
      for (const theme of ['dark', 'light'] as const) {
        const tint = deriveTint(hex, theme)!;
        expect(contrastRatio(tint.text, tint.wash)).toBeGreaterThanOrEqual(
          AA_NORMAL_TEXT,
        );
      }
    });
  });

  it('refuses a colour it cannot read rather than guessing', () => {
    expect(deriveTint('nonsense', 'dark')).toBeNull();
  });
});

/**
 * The pair the stylesheet switches between.
 *
 * `tintVars` is the fix for the bug above: it emits both fits so a server
 * component — which cannot know the theme — does not have to choose one. The
 * risk it introduces is a *silent* one, since a missing half leaves
 * `var(--tint-text)` invalid and the element quietly falls back to inheriting,
 * which looks deliberate. So the shape is checked rather than assumed.
 */
describe('tintVars', () => {
  it('emits both fits of everything that depends on the ground', () => {
    const vars = tintVars('#F0724A')!;

    expect(Object.keys(vars).sort()).toEqual([
      '--tint-fill',
      '--tint-text-dark',
      '--tint-text-light',
      '--tint-wash-dark',
      '--tint-wash-light',
    ]);
  });

  it('gives the two fits genuinely different values', () => {
    // The failure this guards against is subtle: emit the same colour twice and
    // every selector still resolves, every test above still passes, and the
    // light theme is exactly as broken as it was before.
    for (const [, hex] of COVER_COLOURS) {
      const vars = tintVars(hex)!;
      expect(vars['--tint-text-dark']).not.toBe(vars['--tint-text-light']);
      expect(vars['--tint-wash-dark']).not.toBe(vars['--tint-wash-light']);
    }
  });

  it('leaves fill unpaired, because it does not depend on the ground', () => {
    const vars = tintVars('#1B2A6B')!;
    expect(vars['--tint-fill']).toBe(deriveTint('#1B2A6B', 'dark')!.fill);
    expect(vars['--tint-fill']).toBe(deriveTint('#1B2A6B', 'light')!.fill);
  });

  it('says nothing when there is no colour, so the theme keeps its own', () => {
    expect(tintVars(null)).toBeNull();
    expect(tintVars(undefined)).toBeNull();
    expect(tintVars('')).toBeNull();
    expect(tintVars('not-a-colour')).toBeNull();
  });
});

/**
 * A cover with no colour in it still has to produce a page.
 *
 * `refit` refuses to invent a hue for a near-grey input, which is correct and
 * means the greyscale branch produces a different set of values from every
 * other input — so it is the branch most likely to drift out of contrast
 * unnoticed.
 */
describe('tintedScheme', () => {
  it('falls back rather than guessing when the colour is unreadable', () => {
    expect(tintedScheme('not-a-colour')).toBeNull();
  });

  it('produces a neutral page for a greyscale cover', () => {
    const scheme = tintedScheme('#7A7A7A')!;
    expect(contrastRatio(scheme.textPrimary, scheme.bg)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  /**
   * The complaint this function exists to answer: the extracted colour is the
   * *brightest* region of the artwork, so a page painted in it puts the cover on
   * a ground made of its own highlights and the two compete.
   *
   * Stated as a ceiling rather than as "darker than the input", which is the
   * obvious version and is wrong at one end — a near-black cover has to be
   * lifted *up* to L 0.22 or the page has no ground at all, only a void. What
   * has to be true for every input is that the result is dark, full stop.
   */
  it('lands every cover on a dark ground', () => {
    for (const [, hex] of COVER_COLOURS) {
      const scheme = tintedScheme(hex)!;
      expect(relativeLuminance(hexToRgb(scheme.bg)!)).toBeLessThan(0.05);
    }
  });

  it('darkens a bright cover rather than painting the page in it', () => {
    for (const [, hex] of COVER_COLOURS) {
      const cover = relativeLuminance(hexToRgb(hex)!);
      if (cover < 0.05) continue;

      expect(relativeLuminance(hexToRgb(tintedScheme(hex)!.bg)!)).toBeLessThan(cover);
    }
  });
});

/**
 * Composite a translucent token over its ground.
 *
 * Several tokens are `rgba(...)` so they work over any surface. Contrast is a
 * property of what the eye receives, so they have to be flattened against the
 * ground before being measured — comparing the raw value would be measuring a
 * colour that is never painted.
 */
function flatten(overlay: string, ground: string): string {
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(overlay);
  if (!match) return overlay;

  const [, r, g, b, a = '1'] = match;
  const alpha = Number(a);
  const base = ground.replace('#', '');
  const groundRgb = [0, 2, 4].map((i) => parseInt(base.slice(i, i + 2), 16));

  const mixed = [Number(r), Number(g), Number(b)].map((channel, i) =>
    Math.round(channel * alpha + groundRgb[i]! * (1 - alpha)),
  );

  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
