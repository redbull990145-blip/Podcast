import { describe, expect, it } from "vitest";
import { mergeResults, type PodcastSearchResult } from "./search";

function result(over: Partial<PodcastSearchResult> = {}): PodcastSearchResult {
  return {
    feedUrl: "https://feeds.example.com/show.xml",
    title: "A Show",
    author: null,
    artworkUrl: null,
    description: null,
    categories: [],
    episodeCount: null,
    itunesId: null,
    podcastindexId: null,
    sources: ["itunes"],
    ...over,
  };
}

describe("mergeResults", () => {
  it("keeps distinct shows separate", () => {
    const merged = mergeResults(
      [result({ feedUrl: "https://a.example/f.xml" })],
      [result({ feedUrl: "https://b.example/f.xml", sources: ["podcastindex"] })],
    );
    expect(merged).toHaveLength(2);
  });

  it("dedupes the same feed across catalogues", () => {
    const merged = mergeResults(
      [result({ itunesId: 1 })],
      [result({ podcastindexId: 99, sources: ["podcastindex"] })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].itunesId).toBe(1);
    expect(merged[0].podcastindexId).toBe(99);
    expect(merged[0].sources).toEqual(["itunes", "podcastindex"]);
  });

  it("treats cosmetically different feed URLs as the same show", () => {
    // The two catalogues routinely disagree on www and trailing slashes.
    const merged = mergeResults(
      [result({ feedUrl: "https://www.feeds.example.com/show.xml" })],
      [
        result({
          feedUrl: "https://feeds.example.com/show.xml/",
          sources: ["podcastindex"],
        }),
      ],
    );
    expect(merged).toHaveLength(1);
  });

  it("fills gaps from the duplicate instead of discarding it", () => {
    // iTunes brings artwork but no description; PodcastIndex the reverse.
    const merged = mergeResults(
      [result({ artworkUrl: "https://cdn/art.jpg" })],
      [
        result({
          description: "A show about things.",
          author: "Dana Okafor",
          sources: ["podcastindex"],
        }),
      ],
    );

    expect(merged[0].artworkUrl).toBe("https://cdn/art.jpg");
    expect(merged[0].description).toBe("A show about things.");
    expect(merged[0].author).toBe("Dana Okafor");
  });

  it("prefers the richer category list", () => {
    const merged = mergeResults(
      [result({ categories: ["Technology"] })],
      [
        result({
          categories: ["Technology", "Science", "Education"],
          sources: ["podcastindex"],
        }),
      ],
    );
    expect(merged[0].categories).toHaveLength(3);
  });

  it("handles an empty list from a catalogue that was down", () => {
    const merged = mergeResults([result()], []);
    expect(merged).toHaveLength(1);
  });
});
