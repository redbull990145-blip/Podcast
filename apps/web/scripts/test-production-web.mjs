/** Smoke-test the built Next artifact using synthetic loopback services only. */
/* global document */ // page.evaluate executes in Chromium.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const cwd = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  assert.equal(existsSync(new URL(`../${name}`, import.meta.url)), false, 'Smoke test refuses local environment files');
}
const apiOrigin = 'http://127.0.0.1:38947';
const api = createServer((_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, data: { user: null, sessionExpiresAt: null, items: [], nextCursor: null } }));
});
const probe = createServer();
await new Promise((yes, no) => { probe.once('error', no); probe.listen(0, '127.0.0.1', yes); });
const port = probe.address().port;
await new Promise((yes) => probe.close(yes));
const origin = `http://127.0.0.1:${port}`;
await new Promise((yes, no) => { api.once('error', no); api.listen(38947, '127.0.0.1', yes); });
const env = { ...process.env, API_URL: apiOrigin, NEXT_PUBLIC_API_URL: apiOrigin, INTERNAL_API_TOKEN: '', NEXT_TELEMETRY_DISABLED: '1' };
let logs = '';
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (chunk) => { logs += chunk; });
server.stderr.on('data', (chunk) => { logs += chunk; });
let launchError;
server.on('error', (error) => { launchError = error; });
let browser;
try {
  const started = Date.now();
  for (;;) {
    if (launchError) throw launchError;
    if (server.exitCode !== null) throw new Error(`Next smoke server exited: ${logs}`);
    try { if ((await fetch(`${origin}/signin`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* Startup only. */ }
    if (Date.now() - started > 30_000) throw new Error(`Next startup exceeded deadline: ${logs}`);
    await new Promise((yes) => setTimeout(yes, 100));
  }
  const read = () => fetch(`${origin}/signin`, { headers: { 'Content-Security-Policy': "script-src 'nonce-attacker'", 'x-nonce': 'attacker' } });
  const first = await read(); const second = await read();
  const nonce = first.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce); assert.notEqual(nonce, 'attacker');
  assert.notEqual(nonce, second.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1]);
  assert.equal(first.headers.get('x-cue-source-dirty'), 'true');
  assert.match(first.headers.get('x-cue-revision') || '', /^[a-f0-9]{40}$/);
  const worker = await fetch(`${origin}/sw.js`);
  assert.match(worker.headers.get('cache-control') || '', /no-store/);
  assert.ok(worker.headers.get('content-security-policy')?.includes(apiOrigin));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ extraHTTPHeaders: { 'Content-Security-Policy': "script-src 'nonce-attacker'" } });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? route.continue() : route.abort();
  });
  const violations = [];
  page.on('console', (message) => { if (/violates.*Content Security Policy|Refused to execute inline script/i.test(message.text())) violations.push(message.text()); });
  const response = await page.goto(`${origin}/signin`, { waitUntil: 'networkidle' });
  const browserNonce = (await response.allHeaders())['content-security-policy'].match(/'nonce-([^']+)'/)[1];
  const scripts = await page.evaluate(() => [...document.scripts].filter((script) => !script.type || script.type === 'module' || script.type === 'text/javascript').map((script) => ({ nonce: script.nonce, src: script.src })));
  assert.ok(scripts.length > 2);
  for (const script of scripts) assert.equal(script.nonce, browserNonce, `Script missing the document nonce: ${script.src}`);
  assert.deepEqual(violations, []);
  assert.ok(await page.locator('input').count());
  process.stdout.write(`${JSON.stringify({ environment: 'built Next production artifact + real Chromium + synthetic loopback API', browser: await browser.version(), passed: 4, checks: ['fresh nonces replace attacker request policy', 'built revision and dirty provenance served', 'worker policy and no-store headers served', 'all executable Next scripts carry nonce and render without CSP execution errors'] }, null, 2)}\n`);
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = new Promise((yes) => server.once('exit', yes));
    server.kill();
    await stopped;
  }
  await new Promise((yes) => api.close(yes));
}
