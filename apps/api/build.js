/**
 * Production build.
 *
 * Workspace packages (`@cue/*`) ship TypeScript source, so they must be
 * bundled — Node cannot load them directly. Everything from node_modules stays
 * external: bundling `fastify` and `postgres` would be slower to build, larger
 * to ship, and would break any package that resolves files at runtime.
 */

import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@cue/'));

await build({
  // Two entrypoints, one bundle config. The worker can run inside the API or as
  // its own process; building both every time means the choice is a deployment
  // setting rather than a rebuild.
  entryPoints: { index: 'src/index.ts', worker: 'src/worker-main.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  minify: false, // Server-side: readable stack traces beat a smaller file.
  external,
  logLevel: 'info',
  banner: {
    // Some CJS dependencies reach for `require` even under ESM.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
