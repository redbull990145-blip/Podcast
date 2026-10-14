import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const guard = fileURLToPath(new URL('./check-public-files.mjs', import.meta.url));
function inspect(files) {
  const directory = mkdtempSync(join(tmpdir(), 'cue-public-guard-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory, windowsHide: true });
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(directory, name)), { recursive: true });
      writeFileSync(join(directory, name), content);
    }
    execFileSync('git', ['add', '.'], { cwd: directory, windowsHide: true, stdio: 'ignore' });
    const result = spawnSync(process.execPath, [guard], { cwd: directory, encoding: 'utf8', windowsHide: true });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    // Only remove the disposable test directory created above.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('cue-public-guard-'));
    rmSync(directory, { recursive: true, force: true });
  }
}
test('permits an environment template and public API URL', () => {
  assert.equal(inspect({ '.env.example': 'GROQ_API_KEY=\n', 'apps/web/api.ts': "process.env.NEXT_PUBLIC_API_URL" }).status, 0);
});
test('blocks accidentally staged local environment variants without exposing contents', () => {
  const result = inspect({ 'apps/web/.env (2)': 'fixture content must stay private' });
  assert.equal(result.status, 1);
  assert.ok(result.output.includes('.env (2)'));
  assert.ok(!result.output.includes('fixture content must stay private'));
});
test('blocks tracked local database and worker output', () => {
  assert.equal(inspect({ 'apps/api/.pglite-dev/data': 'fixture', 'apps/web/.open-next/worker.js': 'fixture' }).status, 1);
});

test('blocks environment directories as well as files', () => {
  assert.equal(inspect({ 'apps/api/.env.production/config.json': 'fixture' }).status, 1);
});
test('blocks a private credential variable with a public client prefix', () => {
  assert.equal(inspect({ 'apps/mobile/client.ts': 'process.env.EXPO_PUBLIC_GROQ_API_KEY' }).status, 1);
});
