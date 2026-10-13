/**
 * The SSRF and memory-safety properties of artwork fetching.
 *
 * `extractArtworkColor` runs server-side on a URL that comes straight out of a
 * publisher's RSS — `<itunes:image href="…">` — so the href is attacker
 * controlled. Before this was guarded it was a proxy into the deployment's own
 * network, reachable unauthenticated through both ingest and `/episodes/:id/tint`:
 * point the href at `169.254.169.254` and colour extraction reads the cloud
 * metadata endpoint. These tests pin the guard, the redirect re-validation, and
 * the streaming size cap that a lying `content-length` must not defeat.
 *
 * Literal IPs throughout, so the checks never depend on live DNS.
 */

import { describe, expect, it, vi } from 'vitest';
import { extractArtworkColor } from './artwork-color.ts';

/** A 1×1 red PNG — enough for sharp to return a colour. */
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const asFetch = (fn: (url: string, init?: unknown) => Promise<Response>) =>
  fn as unknown as typeof fetch;

describe('extractArtworkColor SSRF guard', () => {
  it('keeps artwork body failures from rejecting an ingest', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error('publisher disconnected')); },
    });
    await expect(extractArtworkColor('http://198.51.100.10/cover.png', {
      fetchImpl: asFetch(async () => new Response(body)),
    })).resolves.toBeNull();
  });
  it.each([
    ['loopback', 'http://127.0.0.1/cover.png'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['private 10/8', 'http://10.0.0.5/cover.png'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/cover.png'],
  ])('refuses %s without ever fetching it', async (_label, url) => {
    const fetchImpl = vi.fn();
    const color = await extractArtworkColor(url, { fetchImpl: asFetch(fetchImpl as never) });

    expect(color).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not follow a redirect from a public host into a private one', async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requested.push(url);
      // A "public" cover that 302s into the private network — the classic
      // redirect bypass that a plain `fetch` with default redirects would take.
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    });

    const color = await extractArtworkColor('http://198.51.100.10/cover.png', {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(color).toBeNull();
    // It called the public origin once, then refused the private hop before a
    // second request could leave.
    expect(requested).toEqual(['http://198.51.100.10/cover.png']);
    expect(requested.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });

  it('extracts a colour from an allowed public address', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(RED_PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    const color = await extractArtworkColor('http://198.51.100.10/cover.png', {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(color).toMatch(/^#[0-9A-F]{6}$/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts a body that lies about its length and streams past the cap', async () => {
    // Declares 10 bytes, streams 9MB — over the 8MB ceiling. The old code
    // buffered the whole body via arrayBuffer() before checking, so a lie here
    // meant unbounded allocation. The stream must be cut off instead.
    const oneMb = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 9; i += 1) controller.enqueue(oneMb);
        controller.close();
      },
    });

    const fetchImpl = vi.fn(async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '10' },
      }),
    );

    const color = await extractArtworkColor('http://198.51.100.10/big.png', {
      fetchImpl: asFetch(fetchImpl),
    });

    expect(color).toBeNull();
  });

  it('rejects a non-http scheme outright', async () => {
    const fetchImpl = vi.fn();
    const color = await extractArtworkColor('file:///etc/passwd', {
      fetchImpl: asFetch(fetchImpl as never),
    });

    expect(color).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
