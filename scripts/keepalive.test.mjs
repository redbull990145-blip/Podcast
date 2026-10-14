import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeReadiness, readinessUrl } from './keepalive.mjs';

const ready = () => new Response(JSON.stringify({ ok: true, data: { status: 'ready' } }), { status: 200 });
const quiet = { log() {}, sleepImpl: async () => {} };

test('uses readiness and normalizes trailing slashes', () => {
  assert.equal(readinessUrl('https://api.example.test///'), 'https://api.example.test/health/ready');
  assert.equal(readinessUrl('https://api.example.test/api/'), 'https://api.example.test/api/health/ready');
});

test('rejects missing or unsafe configuration without exposing input', () => {
  for (const url of ['', 'invalid', 'http://api.example.test', 'https://user:private@api.example.test', 'https://api.example.test?key=private', 'https://api.example.test#private']) {
    assert.throws(() => readinessUrl(url), (error) => !error.message.includes('private'));
  }
});

test('confirms API and database readiness with a cold-start budget', async () => {
  await probeReadiness('https://api.example.test', {
    ...quiet,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.example.test/health/ready');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return ready();
    },
  });
});

test('retries timeout and temporary service failure, then succeeds', async () => {
  let attempts = 0;
  let waits = 0;
  await probeReadiness('https://api.example.test', {
    ...quiet,
    fetchImpl: async () => {
      attempts++;
      if (attempts === 1) throw new Error('timeout with private provider details');
      if (attempts === 2) return new Response('private response body', { status: 503 });
      return ready();
    },
    sleepImpl: async (ms) => { assert.equal(ms, 5_000); waits++; },
  });
  assert.equal(attempts, 3);
  assert.equal(waits, 2);
});

test('fails after bounded retries without printing error or body contents', async () => {
  const logs = [];
  let attempts = 0;
  await assert.rejects(probeReadiness('https://api.example.test', {
    ...quiet,
    log: (message) => logs.push(message),
    fetchImpl: async () => { attempts++; throw new Error('private provider detail'); },
  }), /after 3 attempts/);
  assert.equal(attempts, 3);
  assert.equal(logs.length, 2);
  assert.ok(logs.every((message) => !message.includes('private')));
});

test('fails permanent HTTP configuration errors immediately', async () => {
  let attempts = 0;
  await assert.rejects(probeReadiness('https://api.example.test', {
    ...quiet,
    fetchImpl: async () => { attempts++; return new Response('private', { status: 404 }); },
  }), /HTTP 404/);
  assert.equal(attempts, 1);
});

test('an unresponsive request is aborted and retried within a bounded budget', async () => {
  let attempts = 0;
  await assert.rejects(probeReadiness('https://api.example.test', {
    ...quiet,
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => {
      attempts++;
      return new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('test request did not abort')), 1_000);
        signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          reject(signal.reason);
        }, { once: true });
      });
    },
  }), /after 3 attempts/);
  assert.equal(attempts, 3);
});

test('an HTTP 200 login page or liveness body cannot pass readiness', async () => {
  for (const body of ['<html>login</html>', JSON.stringify({ ok: true, data: { status: 'up' } })]) {
    await assert.rejects(probeReadiness('https://api.example.test', {
      ...quiet,
      fetchImpl: async () => new Response(body, { status: 200 }),
    }), /without/);
  }
});
