/**
 * Emits the motion tokens as CSS custom properties.
 *
 * Motion publishes its own variables rather than `@cue/design` reaching across
 * to fetch them: each package emits the tokens it defines, so neither has to
 * know the other's shape and the web build simply concatenates the two.
 *
 * Without this the tokens stop at the package boundary — a React component can
 * `import { duration }` but a Tailwind class cannot, so every hover transition
 * ends up hand-written. That is how a design system quietly stops being one.
 */

import { reducedTween } from './reduced.ts';
import { springEasing } from './spring-easing.ts';
import { spring, type SpringToken } from './springs.ts';
import { cssEasing, duration, easing, type EasingToken } from './timing.ts';

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function buildMotionCssVariables(): string {
  const lines = [':root {'];

  for (const [key, value] of Object.entries(duration)) {
    lines.push(`  --duration-${kebab(key)}: ${value}ms;`);
  }

  // The duration everything collapses to when the user has asked for less
  // motion. Named separately from the scale above because it is a policy, not
  // a choice a component gets to make.
  lines.push(`  --duration-reduced: ${reducedTween.duration}ms;`);

  for (const key of Object.keys(easing) as EasingToken[]) {
    lines.push(`  --ease-${kebab(key)}: ${cssEasing(key)};`);
  }

  /**
   * The springs, for the transitions CSS owns.
   *
   * Emitted as a pair per token, and they have to be used as a pair: a
   * `linear()` curve is a normalised shape, so running one over a duration
   * other than its own settle produces a spring with different physics than the
   * one named. Writing `--spring-standard` with a hand-picked duration is the
   * mistake this comment exists to prevent.
   */
  for (const key of Object.keys(spring) as SpringToken[]) {
    const { easing: curve, durationMs } = springEasing(key);
    lines.push(`  --spring-${kebab(key)}: ${curve};`);
    lines.push(`  --spring-${kebab(key)}-duration: ${durationMs}ms;`);
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
