import { describe, expect, it } from 'vitest';
import { colorSchemes, type ColorScheme } from './color.ts';
import { contrastRatio } from './tint.ts';

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
