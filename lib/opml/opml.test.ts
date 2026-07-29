import { describe, expect, it } from "vitest";
import { buildOpml, parseOpml } from "./opml";

/** Shape emitted by most apps: flat list, xmlUrl + text. */
const STANDARD_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My subscriptions</title></head>
  <body>
    <outline text="The Signal Path" type="rss" xmlUrl="https://feeds.example/sp.xml" htmlUrl="https://signalpath.example"/>
    <outline text="Garage Notes" type="rss" xmlUrl="https://garagenotes.example/feed"/>
  </body>
</opml>`;

/** Apple and a few others nest shows inside category folders. */
const NESTED_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <body>
    <outline text="Technology">
      <outline title="The Signal Path" type="rss" xmlUrl="https://feeds.example/sp.xml"/>
      <outline title="Bits" type="rss" xmlUrl="https://feeds.example/bits.xml"/>
    </outline>
    <outline text="Empty Folder"></outline>
  </body>
</opml>`;

describe("parseOpml", () => {
  it("reads a flat subscription list", () => {
    const outlines = parseOpml(STANDARD_OPML);

    expect(outlines).toHaveLength(2);
    expect(outlines[0]).toEqual({
      feedUrl: "https://feeds.example/sp.xml",
      title: "The Signal Path",
      htmlUrl: "https://signalpath.example",
    });
  });

  it("finds shows nested inside category folders", () => {
    const outlines = parseOpml(NESTED_OPML);
    expect(outlines.map((o) => o.title)).toEqual(["The Signal Path", "Bits"]);
  });

  it("ignores folder outlines that carry no feed", () => {
    const outlines = parseOpml(NESTED_OPML);
    expect(outlines.map((o) => o.title)).not.toContain("Technology");
    expect(outlines.map((o) => o.title)).not.toContain("Empty Folder");
  });

  it("accepts `url` as an alias for `xmlUrl`", () => {
    const outlines = parseOpml(
      `<opml><body><outline text="X" url="https://feeds.example/x.xml"/></body></opml>`,
    );
    expect(outlines[0].feedUrl).toBe("https://feeds.example/x.xml");
  });

  it("falls back from title to text", () => {
    const outlines = parseOpml(
      `<opml><body><outline text="Fallback" xmlUrl="https://f.example/x"/></body></opml>`,
    );
    expect(outlines[0].title).toBe("Fallback");
  });

  it("handles single-quoted attributes", () => {
    const outlines = parseOpml(
      `<opml><body><outline text='Quoted' xmlUrl='https://f.example/q'/></body></opml>`,
    );
    expect(outlines[0]).toMatchObject({
      title: "Quoted",
      feedUrl: "https://f.example/q",
    });
  });

  it("dedupes a show listed under several categories", () => {
    const outlines = parseOpml(`<opml><body>
      <outline text="A"><outline title="Dup" xmlUrl="https://f.example/d"/></outline>
      <outline text="B"><outline title="Dup" xmlUrl="https://f.example/d"/></outline>
    </body></opml>`);
    expect(outlines).toHaveLength(1);
  });

  it("decodes XML entities in titles and URLs", () => {
    const outlines = parseOpml(
      `<opml><body><outline text="Rock &amp; Roll" xmlUrl="https://f.example/x?a=1&amp;b=2"/></body></opml>`,
    );
    expect(outlines[0].title).toBe("Rock & Roll");
    expect(outlines[0].feedUrl).toBe("https://f.example/x?a=1&b=2");
  });

  it("returns nothing for a document with no subscriptions", () => {
    expect(parseOpml("<opml><body></body></opml>")).toEqual([]);
    expect(parseOpml("not xml at all")).toEqual([]);
  });
});

describe("buildOpml", () => {
  it("produces a document that declares OPML 2.0", () => {
    const xml = buildOpml([
      { feedUrl: "https://f.example/a", title: "A", htmlUrl: null },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<opml version="2.0">');
  });

  it("escapes characters that would break the XML", () => {
    const xml = buildOpml([
      {
        feedUrl: "https://f.example/x?a=1&b=2",
        title: 'Rock & Roll <"quoted">',
        htmlUrl: null,
      },
    ]);
    expect(xml).toContain("Rock &amp; Roll &lt;&quot;quoted&quot;&gt;");
    expect(xml).toContain("a=1&amp;b=2");
  });

  it("falls back to the feed URL when a show has no title", () => {
    const xml = buildOpml([
      { feedUrl: "https://f.example/untitled", title: null, htmlUrl: null },
    ]);
    expect(xml).toContain('text="https://f.example/untitled"');
  });
});

describe("OPML round-trip", () => {
  it("survives export then re-import unchanged", () => {
    // This is the property that actually matters: what we hand a user must come
    // back identical, whether they re-import it here or take it elsewhere.
    const original = [
      {
        feedUrl: "https://feeds.example/sp.xml",
        title: "The Signal Path",
        htmlUrl: "https://signalpath.example",
      },
      {
        feedUrl: "https://f.example/x?a=1&b=2",
        title: 'Awkward & "Title"',
        htmlUrl: null,
      },
    ];

    expect(parseOpml(buildOpml(original))).toEqual(original);
  });

  it("survives a round-trip through another app's format", () => {
    const imported = parseOpml(STANDARD_OPML);
    expect(parseOpml(buildOpml(imported))).toEqual(imported);
  });
});
