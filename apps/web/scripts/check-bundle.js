/**
 * The JavaScript budget, enforced.
 *
 * A size measured once is a number in a commit message; a number that fails the
 * build is a budget. This reads Next's own build manifest, gzips the chunks the
 * app shell loads before any route code, and exits non-zero if the total has
 * grown past the ceiling.
 *
 * Measures `rootMainFiles` — the framework, the router, and every shared module
 * the shell pulls in. Route-specific chunks are deliberately out of scope: they
 * vary per page and a regression in one would be averaged away.
 *
 * `polyfillFiles` is deliberately *excluded*, having been briefly and wrongly
 * included here. Next serves that chunk on a `nomodule` script, which a browser
 * with ES-module support never fetches — verified in the browser: the tag is
 * present with `noModule === true` and the file does not appear in the resource
 * timeline at all. At ~39KB gzipped it is by far the largest thing in the
 * manifest, so counting it would have made the budget mostly a measure of bytes
 * nobody downloads.
 *
 * Gzip rather than raw, because gzip is what crosses the network. Brotli would
 * be a little smaller again on most hosts, so this is the pessimistic read.
 *
 * Run after `next build`:  node scripts/check-bundle.js
 */

import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NEXT_DIR = join(import.meta.dirname, '..', '.next');

/**
 * The ceiling, in KB gzipped. The target is 180; this holds the line lower.
 *
 * Measured at 126.4KB, of which React and the App Router runtime are ~111KB —
 * so roughly fifteen kilobytes of that total is this application, and the rest
 * is the cost of the framework it was built on. Set with modest headroom rather
 * than at the target, because a budget only does its job if it fails before the
 * thing it is protecting is already gone.
 */
const BUDGET_KB = 140;

function chunkBytes(file) {
  const raw = readFileSync(join(NEXT_DIR, file));
  return { raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length };
}

const manifest = JSON.parse(readFileSync(join(NEXT_DIR, 'build-manifest.json'), 'utf8'));
const files = manifest.rootMainFiles ?? [];

if (files.length === 0) {
  console.error('No shell chunks in build-manifest.json — did `next build` run?');
  process.exit(1);
}

const measured = files
  .map((file) => ({ file, ...chunkBytes(file) }))
  .sort((a, b) => b.gzip - a.gzip);

const totalGzip = measured.reduce((sum, entry) => sum + entry.gzip, 0);
const kb = (bytes) => (bytes / 1024).toFixed(1);

console.log(`App shell JavaScript — ${measured.length} chunks\n`);
for (const entry of measured) {
  console.log(`  ${kb(entry.gzip).padStart(7)} KB gz  ${kb(entry.raw).padStart(8)} KB raw  ${entry.file}`);
}
console.log(`\n  ${kb(totalGzip).padStart(7)} KB gz total   budget ${BUDGET_KB} KB`);

if (totalGzip > BUDGET_KB * 1024) {
  console.error(
    `\nOver budget by ${kb(totalGzip - BUDGET_KB * 1024)} KB.\n` +
      'Either find the growth or raise the ceiling on purpose — but not by accident.',
  );
  process.exit(1);
}

console.log(`\n  ${kb(BUDGET_KB * 1024 - totalGzip)} KB of headroom.`);
