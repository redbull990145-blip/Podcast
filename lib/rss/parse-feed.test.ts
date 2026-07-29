import { describe, expect, it } from "vitest";
import { parseDuration, parseFeedXml } from "./parse-feed";
import {
  MESSY_FEED,
  MINIMAL_FEED,
  NOT_A_FEED,
  PC20_FEED,
} from "@/tests/fixtures/feeds";

describe("parseDuration", () => {
  it("reads bare seconds", () => {
    expect(parseDuration("3540")).toBe(3540);
  });

  it("reads HH:MM:SS", () => {
    expect(parseDuration("1:02:03")).toBe(3723);
  });

  it("reads MM:SS", () => {
    expect(parseDuration("45:30")).toBe(2730);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDuration("  600  ")).toBe(600);
  });

  it.each<[string | null | undefined, string]>([
    ["garbage", "non-numeric"],
    ["-90", "negative"],
    ["0", "zero"],
    ["1:2:3:4", "too many segments"],
    ["", "empty"],
    [null, "null"],
    [undefined, "undefined"],
  ])("returns null for %s (%s)", (input, _label) => {
    expect(parseDuration(input)).toBeNull();
  });
});

describe("parseFeedXml — Podcasting 2.0 feed", () => {
  it("extracts show metadata", async () => {
    const feed = await parseFeedXml(PC20_FEED);

    expect(feed.title).toBe("The Signal Path");
    expect(feed.author).toBe("Dana Okafor");
    expect(feed.artworkUrl).toBe("https://cdn.example/art/signalpath.jpg");
    expect(feed.language).toBe("en-us");
    expect(feed.lastBuildDate).toEqual(new Date("Tue, 15 Jul 2025 09:00:00 GMT"));
  });

  it("flattens nested and repeated categories", async () => {
    const feed = await parseFeedXml(PC20_FEED);
    expect(feed.categories).toEqual(["Technology", "Software How-To", "Science"]);
  });

  it("extracts episode fields including PC20 tags", async () => {
    const feed = await parseFeedXml(PC20_FEED);
    const [latest] = feed.episodes;

    expect(latest.guid).toBe("sp-042");
    expect(latest.title).toBe("Why your build is slow");
    expect(latest.enclosureUrl).toBe("https://cdn.example/audio/sp-042.mp3");
    expect(latest.enclosureLength).toBe(48_210_331);
    expect(latest.durationSeconds).toBe(3723);
    expect(latest.episodeNumber).toBe(42);
    expect(latest.seasonNumber).toBe(3);
    expect(latest.imageUrl).toBe("https://cdn.example/art/sp-042.jpg");
    expect(latest.chaptersUrl).toBe("https://cdn.example/chapters/sp-042.json");
  });

  it("prefers the VTT transcript when a feed offers several formats", async () => {
    const feed = await parseFeedXml(PC20_FEED);
    expect(feed.episodes[0].transcriptUrl).toBe("https://cdn.example/tx/sp-042.vtt");
  });

  it("ignores an HTML-only transcript, which can never carry timings", async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
        <channel><title>HTML only</title><item>
          <title>Ep 1</title><guid>html-1</guid>
          <enclosure url="https://cdn.example/1.mp3" type="audio/mpeg" length="1"/>
          <podcast:transcript url="https://example.com/1/transcript" type="text/html"/>
        </item></channel>
      </rss>`;

    const feed = await parseFeedXml(xml);
    expect(feed.episodes[0].transcriptUrl).toBeNull();
  });

  it("falls back to the file extension when type is missing", async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
        <channel><title>No type</title><item>
          <title>Ep 1</title><guid>untyped-1</guid>
          <enclosure url="https://cdn.example/1.mp3" type="audio/mpeg" length="1"/>
          <podcast:transcript url="https://cdn.example/tx/1.srt?v=2"/>
        </item></channel>
      </rss>`;

    const feed = await parseFeedXml(xml);
    expect(feed.episodes[0].transcriptUrl).toBe("https://cdn.example/tx/1.srt?v=2");
  });
});

describe("parseFeedXml — minimal RSS 2.0 feed", () => {
  it("parses a feed with no iTunes namespace at all", async () => {
    const feed = await parseFeedXml(MINIMAL_FEED);

    expect(feed.title).toBe("Garage Notes");
    expect(feed.categories).toEqual([]);
    expect(feed.artworkUrl).toBeNull();
    expect(feed.author).toBeNull();
    expect(feed.episodes).toHaveLength(1);
  });

  it("leaves absent episode metadata null rather than guessing", async () => {
    const feed = await parseFeedXml(MINIMAL_FEED);
    const [only] = feed.episodes;

    expect(only.durationSeconds).toBeNull();
    expect(only.episodeNumber).toBeNull();
    expect(only.chaptersUrl).toBeNull();
    expect(only.transcriptUrl).toBeNull();
    expect(only.enclosureUrl).toBe("https://garagenotes.example/ep1.mp3");
  });
});

describe("parseFeedXml — malformed feed", () => {
  it("skips items that have no audio enclosure", async () => {
    const feed = await parseFeedXml(MESSY_FEED);
    expect(feed.episodes.map((e) => e.title)).not.toContain("No audio here");
    expect(feed.episodes).toHaveLength(3);
  });

  it("falls back to the enclosure URL when guid is missing", async () => {
    const feed = await parseFeedXml(MESSY_FEED);
    const episode = feed.episodes.find((e) => e.title === "Missing guid");
    expect(episode?.guid).toBe("https://roughcuts.example/rc-2.mp3");
  });

  it("nulls unparseable values instead of throwing", async () => {
    const feed = await parseFeedXml(MESSY_FEED);
    const [, byGuid, negative] = feed.episodes;

    expect(feed.episodes[0].enclosureLength).toBeNull(); // "notanumber"
    expect(feed.episodes[0].publishedAt).toBeNull(); // "not a real date"
    expect(byGuid.durationSeconds).toBeNull(); // "garbage"
    expect(negative.durationSeconds).toBeNull(); // "-90"
  });

  it("substitutes a placeholder title rather than an empty string", async () => {
    const feed = await parseFeedXml(MESSY_FEED);
    const untitled = feed.episodes.find((e) => e.guid === "rc-3");
    expect(untitled?.title).toBe("Untitled episode");
  });

  it("trims whitespace from the show title", async () => {
    const feed = await parseFeedXml(MESSY_FEED);
    expect(feed.title).toBe("Rough Cuts");
  });
});

describe("parseFeedXml — not a feed", () => {
  it("rejects HTML served in place of RSS", async () => {
    // Either a throw or an empty result is acceptable; silently returning a
    // plausible-looking podcast is not.
    await expect(async () => {
      const feed = await parseFeedXml(NOT_A_FEED);
      if (feed.episodes.length === 0) throw new Error("no episodes");
    }).rejects.toThrow();
  });
});
