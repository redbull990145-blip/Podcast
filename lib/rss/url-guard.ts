/**
 * Guards against server-side request forgery.
 *
 * Users can paste any URL into "add by RSS", and our server will fetch it. That
 * makes the feed fetcher a confused deputy: without these checks, a URL like
 * http://169.254.169.254/latest/meta-data/ or http://localhost:5432 would let a
 * user reach cloud metadata endpoints and internal services from inside our
 * infrastructure, and read the response back through the error message.
 *
 * This is a hostname/IP-literal filter. It does not stop DNS rebinding (a name
 * that resolves to a public IP on the first lookup and a private one on the
 * second), which is why fetchFeed also refuses to follow redirects and
 * re-validates the final URL.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  // Cloud instance metadata services.
  "metadata.google.internal",
  "metadata.goog",
]);

/** Reserved TLDs that only ever resolve inside a private network. */
const BLOCKED_TLD_SUFFIXES = [".local", ".internal", ".localdomain", ".home.arpa"];

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  const octets = parts.map((p) => {
    // Reject anything that is not plain decimal — "0x7f.1" and "017.1" are
    // valid IPv4 literals to many resolvers but would slip past a naive parse.
    if (!/^\d{1,3}$/.test(p)) return NaN;
    return Number(p);
  });
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;

  const [a, b] = octets;
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. cloud metadata at 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isPrivateIPv6(host: string): boolean {
  // URL parsing leaves IPv6 literals wrapped in brackets.
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(h)) return true;
  if (/^fe[89ab]/.test(h)) return true;

  // IPv4-mapped addresses. The URL parser rewrites the dotted form into hex —
  // ::ffff:127.0.0.1 becomes ::ffff:7f00:1 — so check both spellings or the
  // loopback slips straight through.
  const dotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isPrivateIPv4(dotted[1]);

  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    const ipv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
    return isPrivateIPv4(ipv4);
  }

  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Returns a normalized URL, or throws UnsafeUrlError.
 *
 * Callers should surface the message to the user — it explains what was wrong
 * with their URL without leaking anything about our network.
 */
export function assertSafeFeedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Feed URLs must start with http:// or https://.");
  }

  // Credentials in the URL are a smuggling vector (http://real.com@evil.com).
  if (url.username || url.password) {
    throw new UnsafeUrlError("Feed URLs must not contain a username or password.");
  }

  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UnsafeUrlError("That address isn't reachable.");
  }
  if (BLOCKED_TLD_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UnsafeUrlError("That address isn't reachable.");
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new UnsafeUrlError("That address isn't reachable.");
  }
  // A bare hostname with no dot is almost always an internal service name.
  if (!host.includes(".") && !host.includes(":")) {
    throw new UnsafeUrlError("That address isn't reachable.");
  }

  return url;
}

/** Non-throwing variant for validating without a try/catch at the call site. */
export function isSafeFeedUrl(raw: string): boolean {
  try {
    assertSafeFeedUrl(raw);
    return true;
  } catch {
    return false;
  }
}
