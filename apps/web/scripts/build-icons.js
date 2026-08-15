/**
 * Emits public/icon-*.png from one vector definition.
 *
 * Same reasoning as build-tokens.js: the mark is defined once and the raster
 * sizes are derived, so the 192px icon cannot quietly become a different
 * drawing from the 512px one. The colours come from the design tokens rather
 * than being picked to look close.
 *
 * Not wired into `prebuild`. These are static assets, not build artefacts —
 * they are committed, and regenerating them on every deploy would churn four
 * binary files for nothing. Run by hand when the mark changes:
 *
 *   npm run icons --workspace @cue/web
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { amber, graphite } from '@cue/design';
import sharp from 'sharp';

/**
 * Two destinations, because Next reads them differently.
 *
 * `app/` is a file convention: an `icon.svg` or `apple-icon.png` there becomes
 * a `<link rel>` in every page's head with no markup written by hand. `public/`
 * is served verbatim, which is what the manifest's absolute paths need — those
 * are read by an OS installer rather than by the page.
 */
const PUBLIC = join(import.meta.dirname, '../public');
const APP = join(import.meta.dirname, '../app');

const BG = graphite[1000];
const CUE = amber[500];
const HEAD = amber[400];

/**
 * The mark: a cue line, with a play head leaving it.
 *
 * Drawn on a 512 grid. `scale` shrinks it toward the centre for the maskable
 * variant, whose outer fifth may be cropped to any shape the launcher likes —
 * a circle on one Android skin, a squircle on the next.
 */
function mark(scale) {
  const centre = 256;
  const s = (value) => centre + (value - centre) * scale;

  return `
  <rect x="${s(150)}" y="${s(140)}" width="${44 * scale}" height="${232 * scale}" rx="${22 * scale}" fill="${CUE}"/>
  <path d="M ${s(238)} ${s(140)} L ${s(238)} ${s(372)} L ${s(398)} ${s(256)} Z" fill="${HEAD}"/>`;
}

function svg({ scale = 1, rounded = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${BG}"/>${mark(scale)}
</svg>`;
}

const targets = [
  { dir: PUBLIC, file: 'icon-192.png', size: 192, source: svg() },
  { dir: PUBLIC, file: 'icon-512.png', size: 512, source: svg() },
  // Square and full-bleed: a rounded corner here would be cropped *again* by
  // the launcher's own mask and end up visibly clipped.
  {
    dir: PUBLIC,
    file: 'icon-maskable-512.png',
    size: 512,
    source: svg({ scale: 0.62, rounded: false }),
  },
  // 180px is what iOS asks for. Kept even though there is no iOS app: this is
  // the web, and Safari on a Mac uses it for a pinned tab.
  { dir: APP, file: 'apple-icon.png', size: 180, source: svg() },
];

for (const target of targets) {
  const buffer = await sharp(Buffer.from(target.source))
    .resize(target.size, target.size)
    .png({ compressionLevel: 9 })
    .toBuffer();

  writeFileSync(join(target.dir, target.file), buffer);
  console.warn(`wrote ${target.file} (${buffer.length} bytes)`);
}

// The vector is the favicon, and the source the rasters can be rebuilt from.
writeFileSync(join(APP, 'icon.svg'), `${svg()}\n`);
console.warn('wrote icon.svg');
