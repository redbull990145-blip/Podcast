/**
 * SSRF protection for user-submitted feed URLs.
 *
 * Anyone can hand this API a URL and ask it to fetch it. Without a guard that
 * makes the server a proxy into its own private network — the classic target
 * being a cloud metadata endpoint at 169.254.169.254, which hands out
 * credentials to whoever asks from inside the instance.
 *
 * Defences here, in order of what they stop:
 *   1. Scheme allowlist            — `file://`, `gopher://`, `redis://`
 *   2. Hostname denylist           — `localhost`, `*.internal`, metadata names
 *   3. DNS resolution check        — `evil.com` that resolves to 10.0.0.1
 *   4. Redirect re-validation      — a public URL that 302s to a private one
 *   5. Size and time caps          — a feed that never ends
 *
 * KNOWN RESIDUAL RISK: there is a TOCTOU window between our DNS check and the
 * socket connecting, so an attacker controlling a DNS server with a ~0s TTL
 * could in principle rebind between the two. Closing it fully means pinning
 * the connection to the address we validated, via a custom undici dispatcher
 * with its own `lookup`. Deliberately not done yet — noted rather than
 * pretended away, and `resolveHostname` is factored so the dispatcher can be
 * dropped in without touching callers.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type UrlRejection =
  | 'invalid-url'
  | 'bad-scheme'
  | 'blocked-hostname'
  | 'private-address'
  | 'dns-failure';

/**
 * `detail?: undefined` on the success branch is deliberate, and is not the
 * union carrying a field it has no use for.
 *
 * Callers read `check.detail` inside `if (!check.allowed)`, which is only legal
 * because narrowing picks the failure branch. Narrowing is a function of the
 * *compiler settings*, not of this file: under `strict: false` TypeScript stops
 * narrowing discriminated unions entirely, and every one of those reads becomes
 * a TS2339 in code that is otherwise correct. That is not hypothetical — it is
 * how this repo's deploys failed, twice, when a tsconfig `extends` silently
 * fell back to bare defaults (see apps/api/tsconfig.json).
 *
 * Declaring the property as optional-and-always-undefined on the other branch
 * makes the read well-typed without narrowing, while keeping `allowed` a real
 * discriminant: under `strict` this still narrows to `string`, so nothing is
 * lost where the config is intact. `reason` gets the same treatment for the
 * same reason — the tests read it under exactly this pattern.
 */
export type UrlCheck =
  | { allowed: true; url: URL; addresses: string[]; detail?: undefined; reason?: undefined }
  | { allowed: false; reason: UrlRejection; detail: string };

/**
 * Hostnames that never legitimately serve a podcast feed. Checked before DNS
 * so an obvious attempt fails fast and without a lookup.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa'];

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Reject `01` and `1e2` — Number() would accept forms the resolver won't.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** CIDR blocks that must never be reachable from a user-supplied URL. */
const BLOCKED_V4: Array<{ base: string; bits: number; label: string }> = [
  { base: '0.0.0.0', bits: 8, label: 'this network' },
  { base: '10.0.0.0', bits: 8, label: 'private' },
  { base: '100.64.0.0', bits: 10, label: 'carrier-grade NAT' },
  { base: '127.0.0.0', bits: 8, label: 'loopback' },
  { base: '169.254.0.0', bits: 16, label: 'link-local / cloud metadata' },
  { base: '172.16.0.0', bits: 12, label: 'private' },
  { base: '192.0.0.0', bits: 24, label: 'IETF protocol assignments' },
  { base: '192.0.2.0', bits: 24, label: 'documentation' },
  { base: '192.168.0.0', bits: 16, label: 'private' },
  { base: '198.18.0.0', bits: 15, label: 'benchmarking' },
  { base: '224.0.0.0', bits: 4, label: 'multicast' },
  { base: '240.0.0.0', bits: 4, label: 'reserved' },
];

function isBlockedIpv4(address: string): string | null {
  const value = ipv4ToInt(address);
  if (value === null) return 'malformed IPv4 address';

  for (const { base, bits, label } of BLOCKED_V4) {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) continue;
    // `>>> 0` keeps the mask unsigned; a /0 shift in JS is a no-op, but no
    // range here uses one.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (baseValue & mask) >>> 0) return label;
  }
  return null;
}

function isBlockedIpv6(address: string): string | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');

  if (normalized === '::1') return 'loopback';
  if (normalized === '::') return 'unspecified';

  // IPv4-mapped (`::ffff:127.0.0.1`) must be judged on the embedded IPv4, or
  // every v4 rule above is trivially bypassed by wrapping the address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);

  // fc00::/7 unique-local, fe80::/10 link-local.
  if (/^f[cd]/.test(normalized)) return 'unique-local';
  if (/^fe[89ab]/.test(normalized)) return 'link-local';

  return null;
}

/** Public entry point for address checking; used for redirect hops too. */
export function isBlockedAddress(address: string): string | null {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return 'not an IP address';
}

function checkHostname(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');

  if (BLOCKED_HOSTNAMES.has(host)) return `"${host}" is not a public host`;
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) return `"${suffix}" names are not public`;
  }
  return null;
}

/**
 * Normalise a feed URL so the same feed reached two ways is one podcast.
 *
 * Conservative on purpose: host is lowercased, the default port and the
 * fragment are dropped. Query strings are left alone — plenty of feeds carry
 * real routing information there, and stripping "tracking-looking" params
 * would break them.
 */
export function normalizeFeedUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  url.hash = '';

  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  return url;
}

async function resolveHostname(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

/**
 * Full check. Returns the validated URL plus the addresses it resolved to, so
 * a caller can log exactly what it was about to talk to.
 */
export async function checkUrl(input: string): Promise<UrlCheck> {
  const url = normalizeFeedUrl(input);
  if (!url) {
    return { allowed: false, reason: 'invalid-url', detail: 'Could not be parsed as a URL' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      allowed: false,
      reason: 'bad-scheme',
      detail: `${url.protocol} is not supported — use http or https`,
    };
  }

  const hostnameProblem = checkHostname(url.hostname);
  if (hostnameProblem) {
    return { allowed: false, reason: 'blocked-hostname', detail: hostnameProblem };
  }

  // A literal IP skips DNS entirely and is checked directly.
  if (isIP(url.hostname) !== 0) {
    const blocked = isBlockedAddress(url.hostname);
    if (blocked) {
      return { allowed: false, reason: 'private-address', detail: `Address is ${blocked}` };
    }
    return { allowed: true, url, addresses: [url.hostname] };
  }

  let addresses: string[];
  try {
    addresses = await resolveHostname(url.hostname);
  } catch {
    return {
      allowed: false,
      reason: 'dns-failure',
      detail: `Could not resolve ${url.hostname}`,
    };
  }

  if (addresses.length === 0) {
    return { allowed: false, reason: 'dns-failure', detail: 'Host resolved to no addresses' };
  }

  // Every address must be public. A host that resolves to one public and one
  // private address is an attack, not a misconfiguration.
  for (const address of addresses) {
    const blocked = isBlockedAddress(address);
    if (blocked) {
      return {
        allowed: false,
        reason: 'private-address',
        detail: `${url.hostname} resolves to a ${blocked} address`,
      };
    }
  }

  return { allowed: true, url, addresses };
}
