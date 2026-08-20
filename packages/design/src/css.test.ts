import { describe, expect, it } from 'vitest';
import { buildCssVariables } from './css.ts';
import { dark, light } from './tokens/color.ts';
import { radiusForArtwork } from './index.ts';
import { artworkRadius } from './tokens/layout.ts';

describe('buildCssVariables', () => {
  const css = buildCssVariables();

  it('emits dark as the default on :root', () => {
    // Dark-first is a design decision, not an accident of ordering: artwork
    // sits better on a dark ground and that is where most listening happens.
    const root = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='light']"));
    expect(root).toContain(`--color-bg: ${dark.bg};`);
  });

  it('overrides every colour when light is selected explicitly', () => {
    const lightBlock = css.slice(css.indexOf("[data-theme='light']"));
    for (const key of Object.keys(light)) {
      const name = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      expect(lightBlock).toContain(`--color-${name}:`);
    }
  });

  it('respects the OS preference only when the user has not chosen', () => {
    // `:root:not([data-theme])` is what makes an explicit in-app choice win
    // over the system setting instead of fighting it.
    expect(css).toContain('@media (prefers-color-scheme: light)');
    expect(css).toContain(':root:not([data-theme])');
  });

  it('converts camelCase token names to kebab-case custom properties', () => {
    expect(css).toContain('--color-text-primary:');
    expect(css).toContain('--color-surface-raised:');
    expect(css).not.toContain('--color-textPrimary');
  });

  it('emits each text style as size, line, tracking and weight', () => {
    expect(css).toContain('--text-title1-size:');
    expect(css).toContain('--text-title1-line:');
    expect(css).toContain('--text-title1-tracking:');
    expect(css).toContain('--text-title1-weight:');
  });

  it('gives spacing and radii px units', () => {
    expect(css).toContain('--space-4: 16px;');
    expect(css).toContain('--radius-md: 8px;');
  });
});

describe('radiusForArtwork', () => {
  it('keeps small thumbnails from turning into blobs', () => {
    expect(radiusForArtwork(44)).toBe(artworkRadius.sm);
  });

  it('scales up with the artwork so a cover is not a sticker', () => {
    expect(radiusForArtwork(120)).toBe(artworkRadius.md);
    expect(radiusForArtwork(240)).toBe(artworkRadius.lg);
    expect(radiusForArtwork(340)).toBe(artworkRadius.xl);
  });

  it('increases monotonically across the size range', () => {
    const sizes = [40, 56, 57, 160, 161, 280, 281, 400];
    const radii = sizes.map(radiusForArtwork);
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]!).toBeGreaterThanOrEqual(radii[i - 1]!);
    }
  });
});
