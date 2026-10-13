import { describe, expect, it, vi } from 'vitest';
import { checkUrl, isBlockedAddress, normalizeFeedUrl } from './url-guard.ts';

describe('isBlockedAddress', () => {
  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback, non-obvious octet', '127.99.1.5'],
    ['private 10/8', '10.0.0.1'],
    ['private 192.168/16', '192.168.1.1'],
    ['private 172.16/12 low', '172.16.0.1'],
    ['private 172.16/12 high', '172.31.255.254'],
    ['cloud metadata', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['this network', '0.0.0.0'],
    ['multicast', '224.0.0.1'],
    ['reserved', '255.255.255.255'],
  ])('blocks %s', (_label, address) => {
    expect(isBlockedAddress(address)).not.toBeNull();
  });

  it.each([
    ['public', '8.8.8.8'],
    ['just outside 172.16/12', '172.32.0.1'],
    ['just below 172.16/12', '172.15.255.254'],
    ['just outside 100.64/10', '100.128.0.1'],
  ])('allows %s', (_label, address) => {
    expect(isBlockedAddress(address)).toBeNull();
  });

  it('blocks IPv4-mapped IPv6 by judging the embedded address', () => {
    // Without this, every IPv4 rule is bypassed by wrapping the address.
    expect(isBlockedAddress('::ffff:127.0.0.1')).not.toBeNull();
    expect(isBlockedAddress('::ffff:169.254.169.254')).not.toBeNull();
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBeNull();
    expect(isBlockedAddress('0:0:0:0:0:ffff:7f00:1')).not.toBeNull();
    expect(isBlockedAddress('::ffff:a9fe:a9fe')).not.toBeNull();
    expect(isBlockedAddress('0:0:0:0:0:0:0:1')).not.toBeNull();
  });

  it.each([
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['unique-local', 'fd00::1'],
    ['link-local', 'fe80::1'],
  ])('blocks %s', (_label, address) => {
    expect(isBlockedAddress(address)).not.toBeNull();
  });

  it('allows a public IPv6 address', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBeNull();
  });

  it.each(['::127.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b:1::a9fe:a9fe', '2002:7f00:1::', '2001:db8::1', '3fff::1', '100::1', '5f00::1'])('blocks non-public or translated IPv6 %s', (address) => {
    expect(isBlockedAddress(address)).not.toBeNull();
  });

  it('rejects octal and overflowing octets that a resolver would read differently', () => {
    // `0177.0.0.1` is 127.0.0.1 to some parsers. Refusing the ambiguous form
    // is safer than trying to match whatever the resolver happens to do.
    expect(isBlockedAddress('0177.0.0.1')).not.toBeNull();
    expect(isBlockedAddress('999.0.0.1')).not.toBeNull();
  });
});

describe('normalizeFeedUrl', () => {
  it('lowercases the host so one feed is not two podcasts', () => {
    expect(normalizeFeedUrl('https://Example.COM/feed.xml')?.href).toBe(
      'https://example.com/feed.xml',
    );
  });

  it('drops the fragment, which never reaches the server anyway', () => {
    expect(normalizeFeedUrl('https://example.com/feed.xml#latest')?.href).toBe(
      'https://example.com/feed.xml',
    );
  });

  it('drops default ports', () => {
    expect(normalizeFeedUrl('https://example.com:443/feed')?.href).toBe('https://example.com/feed');
    expect(normalizeFeedUrl('http://example.com:80/feed')?.href).toBe('http://example.com/feed');
  });

  it('keeps a non-default port', () => {
    expect(normalizeFeedUrl('https://example.com:8443/feed')?.href).toContain(':8443');
  });

  it('preserves the query string, which feeds genuinely route on', () => {
    // Stripping "tracking-looking" params breaks feeds that need them.
    const url = normalizeFeedUrl('https://example.com/feed?showId=42&format=rss');
    expect(url?.search).toBe('?showId=42&format=rss');
  });

  it('returns null for nonsense', () => {
    expect(normalizeFeedUrl('not a url')).toBeNull();
  });
});

describe('checkUrl', () => {
  it('bounds DNS lookup and does not admit a late answer', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (addresses: string[]) => void;
      const resolveHostname = vi.fn(() => new Promise<string[]>((resolve) => { finish = resolve; }));
      const pending = checkUrl('https://fixture.invalid/feed', { resolveHostname });
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await pending).toMatchObject({ allowed: false, reason: 'dns-failure' });
      finish(['8.8.8.8']);
      expect(resolveHostname).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('does not start DNS after caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const resolveHostname = vi.fn().mockResolvedValue(['8.8.8.8']);
    expect(await checkUrl('https://fixture.invalid/feed', { signal: controller.signal, resolveHostname })).toMatchObject({ allowed: false, reason: 'dns-failure' });
    expect(resolveHostname).not.toHaveBeenCalled();
  });
  it.each([
    ['file', 'file:///etc/passwd'],
    ['gopher', 'gopher://example.com/'],
    ['redis', 'redis://localhost:6379'],
  ])('rejects the %s scheme', async (_label, url) => {
    const result = await checkUrl(url);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('bad-scheme');
  });

  it.each([
    'http://localhost/feed.xml',
    'http://printer.local/feed.xml',
    'http://db.internal/feed.xml',
    'http://metadata.google.internal/computeMetadata/v1/',
  ])('rejects the non-public hostname %s without a DNS lookup', async (url) => {
    const result = await checkUrl(url);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('blocked-hostname');
  });

  it('rejects a literal private IP', async () => {
    const result = await checkUrl('http://169.254.169.254/latest/meta-data/');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('private-address');
  });

  it('rejects a trailing-dot hostname that would otherwise dodge the suffix check', async () => {
    const result = await checkUrl('http://localhost./feed.xml');
    expect(result.allowed).toBe(false);
  });

  it('allows a literal public IP without resolving it', async () => {
    const result = await checkUrl('https://8.8.8.8/feed.xml');
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.addresses).toEqual(['8.8.8.8']);
  });

  it('reports a DNS failure rather than throwing', async () => {
    const result = await checkUrl('https://this-host-does-not-exist.invalid/feed.xml');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('dns-failure');
  });
});
