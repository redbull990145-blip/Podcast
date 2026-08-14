/**
 * Emits app/tokens.css from the shared token package.
 *
 * Generating rather than hand-writing is the whole point: web and native read
 * one definition, so a colour cannot drift between platforms.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCssVariables } from '@cue/design/css';
import { buildMotionCssVariables } from '@cue/motion/css';

const header = `/**
 * Design and motion tokens as CSS custom properties.
 *
 * GENERATED from @cue/design and @cue/motion — do not edit by hand.
 * Regenerate with: npm run tokens --workspace @cue/web
 */

`;

// Each package emits its own block; concatenating them here is the only place
// that knows both exist. Motion comes second so its `:root` sits beside the
// design one rather than being buried under the light-theme override.
const outfile = join(import.meta.dirname, '../app/tokens.css');
writeFileSync(
  outfile,
  `${header + buildCssVariables()}\n${buildMotionCssVariables()}`,
  'utf8',
);

console.warn(`wrote ${outfile}`);
