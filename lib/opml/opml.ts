/**
 * OPML import and export.
 *
 * This is the anti-lock-in feature. Every podcast app can read and write OPML,
 * so a working round-trip is what makes leaving this app (or arriving from
 * another one) a non-event. It is deliberately hand-rolled: OPML is a handful
 * of XML elements, and a dependency here would be more code than the format.
 */

export type OpmlOutline = {
  feedUrl: string;
  title: string | null;
  /** <outline htmlUrl> — the show's website, not the feed. */
  htmlUrl: string | null;
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    // Ampersand last, or "&amp;lt;" would decode twice into "<".
    .replace(/&amp;/g, "&");
}

/** Reads a single attribute out of an <outline .../> tag. */
function attribute(tag: string, name: string): string | null {
  // Attribute order varies between exporters, so match by name rather than
  // position, and accept either quote style.
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  if (!match) return null;
  const raw = match[2] ?? match[3] ?? "";
  const value = unescapeXml(raw).trim();
  return value === "" ? null : value;
}

/**
 * Extracts subscriptions from an OPML document.
 *
 * Tolerant by design: exporters disagree about whether the feed lives in
 * `xmlUrl` or `url`, whether the title is `title` or `text`, and whether
 * outlines are nested inside category folders. Anything with a feed URL counts,
 * at any depth.
 */
export function parseOpml(xml: string): OpmlOutline[] {
  const outlines: OpmlOutline[] = [];
  const seen = new Set<string>();

  // Matches both self-closing and container outline tags. A real XML parser is
  // unnecessary here and would choke on the malformed OPML some apps emit.
  const tagPattern = /<outline\b[^>]*>/gi;

  for (const match of xml.matchAll(tagPattern)) {
    const tag = match[0];

    const feedUrl = attribute(tag, "xmlUrl") ?? attribute(tag, "url");
    // Outlines without a feed URL are category folders — descend past them.
    if (!feedUrl) continue;

    // Some exporters list the same show under several categories.
    const key = feedUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    outlines.push({
      feedUrl,
      title: attribute(tag, "title") ?? attribute(tag, "text"),
      htmlUrl: attribute(tag, "htmlUrl"),
    });
  }

  return outlines;
}

/** Builds an OPML 2.0 document from a subscription list. */
export function buildOpml(
  subscriptions: OpmlOutline[],
  options: { title?: string; dateCreated?: Date } = {},
): string {
  const title = options.title ?? "Cadence subscriptions";
  const dateCreated = (options.dateCreated ?? new Date()).toUTCString();

  const body = subscriptions
    .map((sub) => {
      const text = escapeXml(sub.title ?? sub.feedUrl);
      const attrs = [
        `text="${text}"`,
        `title="${text}"`,
        `type="rss"`,
        `xmlUrl="${escapeXml(sub.feedUrl)}"`,
        sub.htmlUrl ? `htmlUrl="${escapeXml(sub.htmlUrl)}"` : null,
      ]
        .filter(Boolean)
        .join(" ");
      return `    <outline ${attrs}/>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(title)}</title>
    <dateCreated>${dateCreated}</dateCreated>
  </head>
  <body>
${body}
  </body>
</opml>
`;
}
