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

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}
