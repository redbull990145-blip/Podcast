/**
 * Emits the token set as CSS custom properties for the web app.
 *
 * The point of generating this rather than hand-writing a stylesheet is that
 * the browser and React Native then read the same numbers from the same file.
 * A token can't drift between platforms because there is only one definition.
 */

import { dark, light, type ColorScheme } from './tokens/color.ts';
import { text, fontWeight } from './tokens/typography.ts';
import { elevation, radius, space, measure } from './tokens/layout.ts';

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function colorVars(scheme: ColorScheme, indent: string): string {
  return (Object.keys(scheme) as Array<keyof ColorScheme>)
    .map((key) => `${indent}--color-${kebab(key)}: ${scheme[key]};`)
    .join('\n');
}

/**
 * Static tokens — identical in both themes.
 */
function staticVars(indent: string): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(space)) {
    lines.push(`${indent}--space-${key}: ${value}px;`);
  }
  for (const [key, value] of Object.entries(radius)) {
    lines.push(`${indent}--radius-${key}: ${value}px;`);
  }
  for (const [key, value] of Object.entries(elevation)) {
    lines.push(`${indent}--elevation-${key}: ${value};`);
  }
  for (const [key, value] of Object.entries(measure)) {
    lines.push(`${indent}--measure-${key}: ${value}px;`);
  }
  for (const [key, value] of Object.entries(fontWeight)) {
    lines.push(`${indent}--font-weight-${key}: ${value};`);
  }
  for (const [key, value] of Object.entries(text)) {
    const name = kebab(key);
    lines.push(`${indent}--text-${name}-size: ${value.fontSize}px;`);
    lines.push(`${indent}--text-${name}-line: ${value.lineHeight}px;`);
    lines.push(`${indent}--text-${name}-tracking: ${value.letterSpacing}em;`);
    lines.push(`${indent}--text-${name}-weight: ${value.fontWeight};`);
  }

  return lines.join('\n');
}

/**
 * Dark is the default and light is the opt-in, because the app is designed
 * dark-first — artwork sits better on a dark ground and that is the surface
 * most listening happens on.
 */
export function buildCssVariables(): string {
  return [
    ':root {',
    staticVars('  '),
    '',
    colorVars(dark, '  '),
    '}',
    '',
    "[data-theme='light'] {",
    colorVars(light, '  '),
    '}',
    '',
    '@media (prefers-color-scheme: light) {',
    '  :root:not([data-theme]) {',
    colorVars(light, '    '),
    '  }',
    '}',
    '',
  ].join('\n');
}
