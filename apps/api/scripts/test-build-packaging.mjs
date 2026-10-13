/** Run after build.js; no database connection or environment file is loaded. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const api = new URL('../', import.meta.url);
for (const entry of ['index', 'worker']) {
  test(`${entry} bundles workspace code and retains external runtime packages`, () => {
    const source = readFileSync(new URL(`dist/${entry}.js`, api), 'utf8');
    assert.ok(/from ["']postgres["']/.test(source), 'postgres must remain external');
    assert.ok(/from ["']drizzle-orm(?:\/postgres-js)?["']/.test(source), 'Drizzle must remain external');
    assert.ok(/import\(["']@electric-sql\/pglite["']\)/.test(source), 'PGlite must remain external');
    assert.ok(!/node_modules\/@electric-sql\/pglite/.test(source), 'PGlite assets must resolve inside its installed package');
    assert.ok(!/(?:from |import\()["']@cue\//.test(source), 'workspace TypeScript must be bundled');
    assert.ok(/\w+\(import\.meta\.dirname, ["']migrations["']\)/.test(source), 'migrations must resolve beside the bundle');
  });
}
test('packaged migrations exactly match committed SQL without replacing their content', () => {
  const original = new URL('../../packages/db/migrations/', api);
  const packaged = new URL('dist/migrations/', api);
  const names = readdirSync(original).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(readdirSync(packaged).filter((name) => name.endsWith('.sql')).sort(), names);
  for (const name of names) {
    assert.deepEqual(readFileSync(new URL(name, packaged)), readFileSync(new URL(name, original)), name);
  }
});
