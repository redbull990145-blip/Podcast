/**
 * Emits the token set as CSS custom properties for the web app.
 *
 * The point of generating this rather than hand-writing a stylesheet is that
 * the browser and React Native then read the same numbers from the same file.
 * A token can't drift between platforms because there is only one definition.
 */

import { dark, light, onyx, type ColorScheme } from './tokens/color.ts';
import { deriveTint } from './tokens/tint.ts';
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
 * One scheme as an inline style object, for a subtree that must not follow the
 * theme.
 *
 * There is exactly one surface like that, and it is the expanded player. Its
 * background is the artwork blurred to nothing under a black scrim — a fixed
 * dark ground, by design, so that text contrast does not depend on which cover
 * happens to be playing. Its *foreground* was reading the ordinary theme
 * tokens, which meant that in the light theme the whole sheet rendered
 * near-black text on a near-black backdrop: title, show name, timecodes and
 * the captions panel all invisible.
 *
 * Overriding the custom properties on the container rather than rewriting the
 * components is what keeps that fix to one line. Everything inside already
 * paints with `var(--color-…)`, so re-declaring those variables on an ancestor
 * re-points the entire subtree at another palette without a single component
 * knowing it happened — including anything added later.
 *
 * Returned as data rather than emitted into the stylesheet because the
 * stylesheet has no selector for "this element and its descendants" that does
 * not amount to inventing a theming API for one component.
 */
export function colorVarStyle(scheme: ColorScheme): Record<string, string> {
  return Object.fromEntries(
    (Object.keys(scheme) as Array<keyof ColorScheme>).map((key) => [
      `--color-${kebab(key)}`,
      scheme[key],
    ]),
  );
}

/**
 * Artwork colour that survives a theme change.
 *
 * `deriveTint` fits its colours to a *named* ground: the dark variant's `text`
 * sits at OKLab L 0.80 so it can clear 4.5:1 on near-black, and its `wash` at
 * L 0.26 so artwork can sit on it. Both are correct, and both are wrong on the
 * other theme — a call site that hardcoded `'dark'` and then used `tint.text`
 * as a colour on the ordinary page rendered light-on-light the moment anybody
 * switched to the light theme. Four screens did exactly that.
 *
 * The obvious fixes do not work here:
 *
 * - **Pass the theme in.** Two of the call sites are server components, and the
 *   server cannot know the theme before paint — that is the whole reason the
 *   choice is applied by a blocking script rather than rendered.
 * - **`light-dark()`.** It resolves against `color-scheme`, which follows the
 *   *operating system*. This app's theme is a `data-theme` attribute, so
 *   `light-dark()` would ignore an in-app choice entirely and contradict every
 *   other colour on the screen.
 *
 * So both variants are emitted and the *stylesheet* picks, using the same three
 * selectors that already switch every other token in `tokens.css`. The switch
 * lives in `globals.css`; this function only supplies the pair, and
 * `TINT_ATTR` is what those rules key off.
 *
 * `fill` has no `-dark`/`-light` pair because `deriveTint` returns the same
 * value for both — it is a saturated background that carries its own
 * foreground, so it does not depend on what is behind it.
 *
 * Returns `null` for a colour it cannot parse, which is the same answer
 * `deriveTint` gives and means "use the theme's own tokens".
 */
export function tintVars(hex: string | null | undefined): Record<string, string> | null {
  if (!hex) return null;

  const onDark = deriveTint(hex, 'dark');
  const onLight = deriveTint(hex, 'light');
  if (!onDark || !onLight) return null;

  return {
    '--tint-wash-dark': onDark.wash,
    '--tint-wash-light': onLight.wash,
    '--tint-text-dark': onDark.text,
    '--tint-text-light': onLight.text,
    '--tint-fill': onDark.fill,
  };
}

/**
 * The attribute the switching rules in `globals.css` select on.
 *
 * An element carrying the variables above must also carry this, or nothing
 * resolves `--tint-text` and `--tint-wash` for it. Exported so the two halves
 * are spelled once rather than agreed by convention.
 */
export const TINT_ATTR = 'data-tint';

/**
 * Everything an element needs to take its text colour from artwork.
 *
 * Returned as props to spread rather than as a style object to merge, because
 * the attribute and the variables have to arrive together — a call site that
 * remembered the colours and forgot the marker would silently fall back to the
 * theme, which looks fine in the theme it was written in.
 *
 * `color` is set here rather than left to a class so the caller keeps its
 * ordinary `text-…` class as the no-artwork fallback: with no colour this
 * returns nothing at all, and the class is simply what applies.
 */
export function tintTextProps(hex: string | null | undefined): {
  'data-tint'?: '';
  style?: Record<string, string>;
} {
  const vars = tintVars(hex);
  if (!vars) return {};

  return { [TINT_ATTR]: '', style: { ...vars, color: 'var(--tint-text)' } };
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
 * Dark is the default and everything else is an opt-in, because the app is
 * designed dark-first — artwork sits better on a dark ground and that is the
 * surface most listening happens on.
 *
 * `onyx` is emitted as its own selector rather than as a second default: it is
 * a *variant* of dark, so someone who has never opened Settings must keep
 * getting the warm one, and the media query below must keep meaning "the system
 * asked for light" rather than "the system asked for one of two darks".
 */
export function buildCssVariables(): string {
  return [
    ':root {',
    staticVars('  '),
    '',
    colorVars(dark, '  '),
    '}',
    '',
    "[data-theme='onyx'] {",
    colorVars(onyx, '  '),
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
