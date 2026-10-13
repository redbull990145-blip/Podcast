/**
 * Production build.
 *
 * Workspace packages (`@cue/*`) ship TypeScript source, so they must be
 * bundled — Node cannot load them directly. Everything from node_modules stays
 * external: bundling `fastify` and `postgres` would be slower to build, larger
 * to ship, and would break any package that resolves files at runtime.
 */

import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { build } from 'esbuild';
import { buildProvenance } from '../../scripts/build-provenance.js';

const runtimePackages = {
  name: 'external-runtime-packages',
  setup(plugin) {
    // Include dependencies reached through workspace source and lazy dev-only
    // imports. Packages such as PGlite resolve WASM/data beside their own module.
    plugin.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === 'entry-point' || args.path.startsWith('@cue/') || isAbsolute(args.path)) return;
      return { path: args.path, external: true };
    });
  },
};
const packagedMigrations = {
  name: 'packaged-migrations',
  setup(plugin) {
    plugin.onLoad({ filter: /[\\/]packages[\\/]db[\\/]src[\\/]migrate\.ts$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const declaration = "export const migrationsDir = join(import.meta.dirname, '../migrations');";
      if (!source.includes(declaration)) throw new Error('Migration directory declaration changed; review API packaging');
      return {
        contents: source.replace(declaration, "export const migrationsDir = join(import.meta.dirname, 'migrations');"),
        loader: 'ts',
      };
    });
  },
};

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
  plugins: [runtimePackages, packagedMigrations],
  define: { __CUE_BUILD_PROVENANCE__: JSON.stringify(buildProvenance()) },
  logLevel: 'info',
  banner: {
    // Some CJS dependencies reach for `require` even under ESM.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

// Relocation affects only built code. Copy unchanged reviewed SQL beside both
// entrypoints; neither building nor this copy applies it to a database.
const migrationsSource = new URL('../../packages/db/migrations/', import.meta.url);
const migrationsOutput = new URL('./dist/migrations/', import.meta.url);
const sqlFiles = readdirSync(migrationsSource).filter((name) => name.endsWith('.sql'));
mkdirSync(migrationsOutput, { recursive: true });
for (const name of readdirSync(migrationsOutput).filter((name) => name.endsWith('.sql'))) {
  if (!sqlFiles.includes(name)) throw new Error(`Unexpected packaged migration: ${name}`);
}
for (const name of sqlFiles) copyFileSync(new URL(name, migrationsSource), new URL(name, migrationsOutput));
