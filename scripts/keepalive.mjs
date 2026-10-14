import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

export function readinessUrl(apiUrl) {
  if (!apiUrl) throw new Error('Set the public API_URL or NEXT_PUBLIC_API_URL repository variable.');
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error('The keepalive API URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('The keepalive API URL must use HTTPS without credentials, query parameters, or a fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/health/ready`;
  return url.href;
}

export async function probeReadiness(apiUrl, {
  fetchImpl = fetch,
  sleepImpl = sleep,
  log = (message) => process.stdout.write(`${message}\n`),
  attempts = 3,
  timeoutMs = 90_000,
} = {}) {
  const url = readinessUrl(apiUrl);
  let failure = 'network failure or timeout';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
        headers: { accept: 'application/json' },
      });
    } catch {
      // Provider errors can include private details. Log statuses and attempt
      // counts only, never URLs, response bodies, or raw error messages.
      failure = 'network failure or timeout';
    }

    if (response?.status === 200) {
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error('Readiness returned HTTP 200 without valid JSON.');
      }
      if (body?.ok !== true || body?.data?.status !== 'ready') {
        throw new Error('Readiness returned HTTP 200 without confirming database readiness.');
      }
      log(`API and database ready (attempt ${attempt}/${attempts}).`);
      return;
    }

    if (response) {
      failure = `HTTP ${response.status}`;
      await response.body?.cancel().catch(() => undefined);
      if (response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw new Error(`Readiness failed with ${failure}; check the API URL and service configuration.`);
      }
    }
    if (attempt < attempts) {
      log(`Readiness ${failure}; retrying (${attempt}/${attempts}).`);
      await sleepImpl(5_000);
    }
  }
  throw new Error(`Readiness unavailable after ${attempts} attempts (${failure}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  probeReadiness(process.env.API_URL).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
