import { describe, expect, it } from "vitest";
import { assertSafeFeedUrl, isSafeFeedUrl, normaliseFeedUrl } from "./url-guard";

describe("assertSafeFeedUrl", () => {
  it("accepts ordinary public feed URLs", () => {
    expect(isSafeFeedUrl("https://feeds.example.com/show.xml")).toBe(true);
    expect(isSafeFeedUrl("http://feeds.example.com/show.xml")).toBe(true);
    expect(isSafeFeedUrl("https://feeds.example.com:8443/show.xml")).toBe(true);
  });

  it("normalizes and returns a URL object", () => {
    const url = assertSafeFeedUrl("  https://feeds.example.com/show.xml  ");
    expect(url.hostname).toBe("feeds.example.com");
  });

  it.each([
    "ftp://feeds.example.com/show.xml",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/xml,<rss/>",
  ])("rejects non-HTTP scheme %s", (url) => {
    expect(isSafeFeedUrl(url)).toBe(false);
  });

  it.each([
    "http://localhost/feed.xml",
    "http://localhost:5432/feed.xml",
    "http://127.0.0.1/feed.xml",
    "http://127.1.2.3/feed.xml",
    "http://0.0.0.0/feed.xml",
    "http://[::1]/feed.xml",
  ])("rejects loopback address %s", (url) => {
    expect(isSafeFeedUrl(url)).toBe(false);
  });

  it.each([
    "http://10.0.0.5/feed.xml",
    "http://172.16.0.1/feed.xml",
    "http://172.31.255.254/feed.xml",
    "http://192.168.1.1/feed.xml",
    "http://100.64.0.1/feed.xml",
    "http://[fd00::1]/feed.xml",
    "http://[fe80::1]/feed.xml",
  ])("rejects private address %s", (url) => {
    expect(isSafeFeedUrl(url)).toBe(false);
  });

  it("rejects the cloud metadata endpoint", () => {
    // The single most valuable SSRF target: returns instance credentials.
    expect(isSafeFeedUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeFeedUrl("http://metadata.google.internal/computeMetadata/v1/")).toBe(
      false,
    );
  });

  it("rejects IPv4-mapped IPv6 loopback", () => {
    expect(isSafeFeedUrl("http://[::ffff:127.0.0.1]/feed.xml")).toBe(false);
  });

  it("rejects internal-only hostnames", () => {
    expect(isSafeFeedUrl("http://db.internal/feed.xml")).toBe(false);
    expect(isSafeFeedUrl("http://printer.local/feed.xml")).toBe(false);
    expect(isSafeFeedUrl("http://redis/feed.xml")).toBe(false);
  });

  it("rejects credentials embedded in the URL", () => {
    // http://trusted.com@evil.com/ reads as trusted.com to a human.
    expect(isSafeFeedUrl("http://feeds.example.com@169.254.169.254/")).toBe(false);
    expect(isSafeFeedUrl("http://user:pass@feeds.example.com/show.xml")).toBe(false);
  });

  it.each([
    ["http://0x7f.0.0.1/feed.xml", "hex octet"],
    ["http://0177.0.0.1/feed.xml", "octal octet"],
    ["http://2130706433/feed.xml", "bare integer"],
  ])("rejects %s (%s) that normalizes to loopback", (url) => {
    // The URL parser rewrites all of these to 127.0.0.1 before we see them, so
    // checking the normalized hostname is what makes this safe. This test pins
    // that behaviour — a parser that stopped normalizing would reopen the hole.
    expect(isSafeFeedUrl(url)).toBe(false);
  });

  it("allows an odd encoding that genuinely resolves to a public address", () => {
    // 017.0.0.1 is octal for 15.0.0.1, which is public. Blocking it would be
    // over-broad: we filter by where the address actually points, not by looks.
    expect(new URL("http://017.0.0.1/").hostname).toBe("15.0.0.1");
    expect(isSafeFeedUrl("http://017.0.0.1/feed.xml")).toBe(true);
  });

  it("rejects garbage input", () => {
    expect(isSafeFeedUrl("not a url")).toBe(false);
    expect(isSafeFeedUrl("")).toBe(false);
  });

  it("explains the problem without leaking network detail", () => {
    expect(() => assertSafeFeedUrl("http://10.0.0.1/x")).toThrowError(
      /isn't reachable/,
    );
    expect(() => assertSafeFeedUrl("ftp://example.com/x")).toThrowError(
      /http:\/\/ or https:\/\//,
    );
  });
});

/**
 * Filling in the scheme almost nobody types.
 *
 * `blog.apaonline.org/feed` is what you get copying a feed address off a show's
 * website, and it used to be refused outright — by the browser first, with an
 * unactionable "Please enter a URL", and by `new URL` behind it.
 */
describe("normaliseFeedUrl", () => {
  it("assumes https when no scheme was given", () => {
    expect(normaliseFeedUrl("blog.apaonline.org/feed")).toBe(
      "https://blog.apaonline.org/feed",
    );
    expect(isSafeFeedUrl("blog.apaonline.org/feed")).toBe(true);
    expect(assertSafeFeedUrl("feeds.example.com/show.xml").hostname).toBe(
      "feeds.example.com",
    );
  });

  it("leaves a scheme that is already there alone", () => {
    for (const url of [
      "https://feeds.example.com/show.xml",
      "http://feeds.example.com/show.xml",
      "HTTPS://Feeds.Example.com/show.xml",
    ]) {
      expect(normaliseFeedUrl(url)).toBe(url);
    }
  });

  it("keeps a port from being mistaken for a scheme", () => {
    // The reason the test is `://` rather than a scheme-shaped prefix: a prefix
    // test leaves this alone, and `new URL` then reads `example.com:` as the
    // protocol and rejects a perfectly good address.
    expect(normaliseFeedUrl("example.com:8443/feed.xml")).toBe(
      "https://example.com:8443/feed.xml",
    );
    expect(isSafeFeedUrl("example.com:8443/feed.xml")).toBe(true);
  });

  it("rewrites the feed:// convention podcast pages use", () => {
    expect(normaliseFeedUrl("feed://example.com/rss")).toBe("https://example.com/rss");
    expect(isSafeFeedUrl("feed://example.com/rss")).toBe(true);
  });

  it("trims, and leaves nothing as nothing", () => {
    expect(normaliseFeedUrl("  example.com/feed  ")).toBe("https://example.com/feed");
    expect(normaliseFeedUrl("   ")).toBe("");
    expect(isSafeFeedUrl("   ")).toBe(false);
  });

  /**
   * The part that matters: completing a URL must not complete a way past the
   * guard. Every case below is something that could only get *worse* if the
   * prepended scheme changed how it parsed.
   */
  it("does not let the assumed scheme smuggle anything through", () => {
    // Other schemes keep theirs, so the protocol check still refuses them
    // rather than them being rewritten into something fetchable.
    expect(isSafeFeedUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeFeedUrl("data:text/xml,<rss/>")).toBe(false);
    expect(isSafeFeedUrl("ftp://example.com/x")).toBe(false);

    // No scheme, but still an address we refuse to fetch.
    expect(isSafeFeedUrl("localhost/feed")).toBe(false);
    expect(isSafeFeedUrl("127.0.0.1/feed")).toBe(false);
    expect(isSafeFeedUrl("10.0.0.1/feed")).toBe(false);
    expect(isSafeFeedUrl("169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeFeedUrl("metadata.google.internal/computeMetadata")).toBe(false);
    expect(isSafeFeedUrl("printer.local/feed")).toBe(false);
    expect(isSafeFeedUrl("intranet/feed")).toBe(false);

    // Credentials are still a smuggling vector with the scheme filled in.
    expect(isSafeFeedUrl("real.com@evil.com/feed")).toBe(false);

    // `javascript:` has no `://`, so it is completed — and the result is not a
    // parseable URL, which is the right answer either way.
    expect(isSafeFeedUrl("javascript:alert(1)")).toBe(false);
  });
});
