import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { UrlCheck } from './url-guard.ts';

/** No second DNS lookup: the socket sees only the addresses checked for this hop. */
export function pinnedLookup(check: Extract<UrlCheck, { allowed: true }>): LookupFunction {
  const hostname = check.url.hostname.replace(/^\[|\]$/g, '');
  const records = check.addresses.map((address) => ({ address, family: isIP(address) }));
  return (host, options, callback) => {
    const family = typeof options.family === 'number' ? options.family : 0;
    const allowed = records.filter((record) => !family || record.family === family);
    if (host !== hostname || !allowed.length) {
      callback(Object.assign(new Error('No validated address for this connection'), { code: 'ENOTFOUND' }), '');
    } else if (options.all) {
      callback(null, allowed);
    } else {
      callback(null, allowed[0]!.address, allowed[0]!.family);
    }
  };
}

export async function fetchChecked(
  check: Extract<UrlCheck, { allowed: true }>,
  init: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  if (fetchImpl) return fetchImpl(check.url.href, init);
  // Keeping the original URL preserves HTTP Host, TLS SNI and certificate checks.
  const agent = new Agent({ connect: { lookup: pinnedLookup(check) }, connections: 1 });
  const close = () => { void agent.destroy().catch(() => undefined); };
  const signal = init.signal;
  signal?.addEventListener('abort', close, { once: true });
  const finish = () => { signal?.removeEventListener('abort', close); close(); };
  try {
    const response = await undiciFetch(check.url.href, {
      method: init.method,
      headers: init.headers as Record<string, string>,
      redirect: 'manual',
      signal,
      dispatcher: agent,
    });
    // Callers use only status/headers for redirects and rejected responses.
    if (!response.body || !response.ok) {
      await response.body?.cancel();
      finish();
      return new Response(null, { status: response.status, headers: response.headers });
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { controller.close(); finish(); }
          else controller.enqueue(chunk.value);
        } catch (error) { controller.error(error); finish(); }
      },
      async cancel(reason) {
        try { await reader.cancel(reason); } finally { finish(); }
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  } catch (error) { finish(); throw error; }
}
