// Starts only a fresh, owned PostgreSQL 17 cluster under the ignored test cache.
// It accepts a portable binary directory, never an existing database URL.
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'node_modules', '.cache', 'phase25');
const supplied = process.argv[2];
if (!supplied)
  throw new Error(
    'Usage: node scripts/test-native-postgres.mjs <approved portable PG17 bin directory>',
  );
const bin = realpathSync(supplied);
const binRelative = relative(realpathSync(cache), bin);
if (isAbsolute(binRelative) || binRelative.startsWith('..'))
  throw new Error('Portable runtime must be inside the approved ignored phase25 test cache');
const binary = (name) => join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
const version = execFileSync(binary('postgres'), ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
if (!/PostgreSQL\) 17\./.test(version))
  throw new Error('This harness requires PostgreSQL major version 17');
const id = randomUUID().replaceAll('-', '');
const cluster = join(cache, `native-${id}`);
const data = join(cluster, 'data');
mkdirSync(cluster, { recursive: false });
const log = join(cluster, 'postgres.log');
const database = `podcast_native_${id}`;
const username = 'podcast_native_test';
const probe = createServer();
await new Promise((yes, no) => {
  probe.once('error', no);
  probe.listen(0, '127.0.0.1', yes);
});
const port = probe.address().port;
await new Promise((yes, no) => probe.close((error) => (error ? no(error) : yes())));
const env = { ...process.env };
for (const key of Object.keys(env))
  if (key === 'DATABASE_URL' || key.startsWith('PG') || key.startsWith('SUPABASE')) delete env[key];
execFileSync(
  binary('initdb'),
  [
    '-D',
    data,
    '-U',
    username,
    '--auth-local=trust',
    '--auth-host=trust',
    '--encoding=UTF8',
    '--no-locale',
  ],
  { windowsHide: true, env, stdio: 'pipe' },
);
// Trust is confined to an owned synthetic cluster bound exclusively to loopback.
const server = spawn(binary('postgres'), ['-D', data, '-h', '127.0.0.1', '-p', String(port)], {
  windowsHide: true,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => appendFileSync(log, chunk));
server.stderr.on('data', (chunk) => appendFileSync(log, chunk));
let launchError;
server.on('error', (error) => {
  launchError = error;
});
let control;
let code;
try {
  const began = Date.now();
  for (;;) {
    if (launchError) throw launchError;
    if (server.exitCode !== null)
      throw new Error(`Disposable PostgreSQL exited before readiness; inspect ${log}`);
    const pidFile = join(data, 'postmaster.pid');
    if (existsSync(pidFile)) {
      const lines = readFileSync(pidFile, 'utf8').trim().split(/\r?\n/);
      if (
        Number(lines[0]) === server.pid &&
        Number(lines[3]) === port &&
        lines.at(-1).trim() === 'ready'
      )
        break;
    }
    if (Date.now() - began > 30_000)
      throw new Error('Disposable PostgreSQL readiness deadline exceeded');
    await new Promise((yes) => setTimeout(yes, 100));
  }
  control = postgres(`postgres://${username}@127.0.0.1:${port}/postgres`, {
    max: 1,
    prepare: false,
  });
  const [actual] = await control`SHOW data_directory`;
  if (realpathSync(actual.data_directory) !== realpathSync(data))
    throw new Error('Refusing a server outside the owned disposable cluster');
  await control.unsafe(`CREATE DATABASE "${database}"`);
  const marker = join(cluster, 'owner.json');
  writeFileSync(
    marker,
    JSON.stringify(
      {
        id,
        database,
        username,
        port,
        data: realpathSync(data),
        runnerPid: process.pid,
        serverPid: server.pid,
        version,
      },
      null,
      2,
    ),
  );
  process.stdout.write(`Native test runtime: ${version}; fresh cluster ${id}; loopback only\n`);
  const tests = spawn(
    process.execPath,
    [
      join(root, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      'src/test/native',
      '--config',
      'vitest.native.config.ts',
      '--configLoader',
      'native',
      '--no-cache',
      '--pool',
      'threads',
      '--maxWorkers',
      '1',
      '--no-file-parallelism',
      '--reporter',
      'default',
      '--reporter',
      'json',
      '--outputFile',
      join(cluster, 'results.json'),
    ],
    {
      cwd: join(root, 'apps', 'api'),
      windowsHide: true,
      stdio: 'inherit',
      env: { ...env, PODCAST_NATIVE_TEST_MARKER: marker },
    },
  );
  code = await new Promise((yes, no) => {
    tests.once('error', no);
    tests.once('exit', (status) => yes(status ?? 1));
  });
} finally {
  if (control) await control.end({ timeout: 5 });
  if (server.exitCode === null && server.pid) {
    // Exact owned cluster only. No service operations, broad kills or deletion.
    // Drain server logs while waiting: a synchronous wait can block its pipe.
    await new Promise((yes, no) => {
      const stop = spawn(binary('pg_ctl'), ['-D', data, 'stop', '-m', 'fast', '-w', '-t', '60'], {
        windowsHide: true,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      stop.stdout.resume();
      stop.stderr.resume();
      stop.once('error', no);
      stop.once('exit', (status) => status === 0 ? yes() : no(new Error(`Owned cluster shutdown failed (${status}); inspect ${log}`)));
    });
  }
  process.stdout.write(`Disposable cluster stopped; retained ignored evidence at ${cluster}\n`);
}
process.exitCode = code;
