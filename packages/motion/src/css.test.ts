import { describe, expect, it } from 'vitest';
import { buildMotionCssVariables } from './css.ts';
import { reducedTween } from './reduced.ts';
import { duration, easing } from './timing.ts';

describe('buildMotionCssVariables', () => {
  const css = buildMotionCssVariables();

  it('emits every duration with a unit', () => {
    for (const [key, value] of Object.entries(duration)) {
      expect(css).toContain(`--duration-${key}: ${value}ms;`);
    }
  });

  it('emits every easing as a cubic-bezier a stylesheet can use', () => {
    for (const key of Object.keys(easing)) {
      const name = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      expect(css).toMatch(new RegExp(`--ease-${name}: cubic-bezier\\(`));
    }
  });

  it('exposes the reduced-motion duration so CSS can honour it too', () => {
    // The JS side reads `reducedTween`; without this variable the stylesheet
    // would have to repeat the number and could drift from it.
    expect(css).toContain(`--duration-reduced: ${reducedTween.duration}ms;`);
  });

  it('converts camelCase token names to kebab-case custom properties', () => {
    expect(css).toContain('--ease-in-out:');
    expect(css).not.toContain('--ease-inOut');
  });

  it('scopes the variables to :root so both themes share them', () => {
    // Motion does not change between light and dark — only colour does.
    expect(css.startsWith(':root {')).toBe(true);
    expect(css).not.toContain('prefers-color-scheme');
  });
});
