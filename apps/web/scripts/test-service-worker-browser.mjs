/** Real Chromium + installed worker. Loopback fixtures and disposable browser profile only.
 * Run with PLAYWRIGHT_MODULE_PATH pointing to an existing playwright package if
 * it is not installed in this workspace. This never installs a browser/package.
 */
/* global caches */ // Functions passed to page.evaluate execute in Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const current = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const legacy = process.env.LEGACY_WORKER_PATH
  ? readFileSync(process.env.LEGACY_WORKER_PATH, 'utf8')
  : execFileSync('git', ['show', 'HEAD:apps/web/public/sw.js'], { encoding: 'utf8' });
let upgrading = false;
let account = 'A';
let sessionExpiresAt = new Date(Date.now() + 300_000).toISOString();
let held;
let holdNext = false;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/sw.js') {
    res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' });
    res.end(upgrading ? current : legacy);
  } else if (path === '/me' || path === '/me/queue') {
    const owner = account;
    if (holdNext && path === '/me/queue') {
      holdNext = false;
      await new Promise((resolve) => { held = resolve; });
    }
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (owner) headers['X-Cue-Account-Id'] = owner;
    res.writeHead(owner ? 200 : 401, headers);
    res.end(JSON.stringify({ ok: !!owner, data: path === '/me' ? { user: owner ? { id: owner } : null, sessionExpiresAt: owner ? sessionExpiresAt : null } : { items: [`${owner}-private`] } }));
  } else {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(`<html><body>${path === '/offline' ? 'NEUTRAL-OFFLINE' : `${account}-private-hydration`}<script>window.fixture=true</script></body></html>`);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const passed = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async (api) => {
    await navigator.serviceWorker.register(`/sw.js?api=${encodeURIComponent(api)}`);
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    await (await caches.open('cue-data-v3')).put('/me/queue', new Response('OLD-A-PRIVATE'));
    await (await caches.open('cue-shell-v4-account-A')).put('/library', new Response('OLD-A-HTML'));
  }, origin);
  upgrading = true;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const changed = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    await registration.update(); await changed;
  });
  // controllerchange can precede completion of activation's waitUntil work.
  const activationDeadline = Date.now() + 30_000;
  let cacheNames;
  do {
    cacheNames = await page.evaluate(() => caches.keys());
    if (cacheNames.length === 1 && cacheNames[0] === 'cue-shell-v5') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < activationDeadline);
  assert.deepEqual(cacheNames, ['cue-shell-v5']);
  passed.push('actual old-worker upgrade purges old private/shared caches');
  const read = (path, owner) => page.evaluate(async ({ path, owner }) => {
    const response = await fetch(path, { headers: owner ? { 'X-Cue-Account-Id': owner } : {} });
    return { status: response.status, body: await response.text() };
  }, { path, owner });
  await read('/me'); await read('/me/queue', 'A');
  await context.setOffline(true);
  assert.match((await read('/me/queue', 'A')).body, /A-private/);
  assert.equal((await read('/me/queue', 'B')).status, 503);
  passed.push('same-account offline cache and old-tab owner rejection');
  await context.setOffline(false);
  account = 'B'; await read('/me'); await read('/me/queue', 'B');
  await context.setOffline(true);
  assert.equal((await read('/me/queue', 'A')).status, 503);
  assert.match((await read('/me/queue', 'B')).body, /B-private/);
  passed.push('A-to-B account switch cannot replay A private data');
  await context.setOffline(false);
  holdNext = true;
  const late = read('/me/queue', 'B');
  while (!held) await new Promise((resolve) => setTimeout(resolve, 10));
  await page.evaluate(async () => {
    navigator.serviceWorker.controller.postMessage({ type: 'purge-data' });
    // Fetch /me is ordered after the message on the same worker event loop.
    await fetch('/me');
  });
  account = 'A'; await read('/me');
  held(); held = undefined; await late;
  assert.ok(!(await page.evaluate(() => caches.keys())).some((key) => key.endsWith('account-B')));
  passed.push('logout/in-flight response cannot recreate departing private cache');
  await read('/me/queue', 'A'); account = null;
  assert.equal((await read('/me')).status, 401);
  await context.setOffline(true);
  assert.equal((await read('/me/queue', 'A')).status, 503);
  passed.push('session expiry invalidates private cache');
  await context.setOffline(false);
  account = 'A'; sessionExpiresAt = new Date(Date.now() + 10_000).toISOString();
  await read('/me'); await read('/me/queue', 'A');
  await context.setOffline(true);
  assert.match((await read('/me/queue', 'A')).body, /A-private/);
  while (Date.now() <= Date.parse(sessionExpiresAt)) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await read('/me/queue', 'A')).status, 503);
  assert.ok(!(await page.evaluate(() => caches.keys())).some((key) => key.endsWith('account-A')));
  passed.push('server expiry prevents private replay while fully offline');
  await context.setOffline(false);
  sessionExpiresAt = new Date(Date.now() + 300_000).toISOString();
  account = 'A'; await read('/me'); await read('/me/queue', 'A');
  await page.goto(`${origin}/library`);
  await context.setOffline(true);
  await page.goto(`${origin}/library`);
  assert.match(await page.textContent('body'), /NEUTRAL-OFFLINE/);
  assert.doesNotMatch(await page.textContent('body'), /private-hydration/);
  passed.push('protected navigation falls back to neutral shell');
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  assert.equal((await read('/me/queue', 'A')).status, 503);
  passed.push('worker cold restart cannot infer identity from existing caches');
  process.stdout.write(`${JSON.stringify({ browser: await browser.version(), environment: 'Chromium headless, installed service worker, synthetic loopback HTTP fixtures', passed: passed.length, checks: passed }, null, 2)}\n`);
} finally {
  held?.();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
