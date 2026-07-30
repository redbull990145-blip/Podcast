import { describe, expect, it } from "vitest";
import {
  buildAffinity,
  describeReason,
  inverseDocumentFrequency,
  rankCandidates,
  scoreCandidate,
  topCategories,
  type Candidate,
} from "./score-candidates";

const NOW = new Date("2026-07-30T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function candidate(overrides: Partial<Candidate> & { feedUrl: string }): Candidate {
  return {
    title: overrides.feedUrl,
    author: null,
    artworkUrl: null,
    description: null,
    categories: [],
    episodeCount: null,
    itunesId: null,
    podcastindexId: null,
    ...overrides,
  };
}

describe("buildAffinity", () => {
  it("weights a finished episode above one merely started", () => {
    const affinity = buildAffinity(
      [
        { event: "complete", categories: ["Technology"], occurredAt: NOW },
        { event: "play_start", categories: ["History"], occurredAt: NOW },
      ],
      [],
      NOW,
    );

    expect(affinity.get("Technology")!.weight).toBeGreaterThan(
      affinity.get("History")!.weight,
    );
  });

  it("treats skips and explicit rejections as negative", () => {
    const affinity = buildAffinity(
      [
        { event: "skip", categories: ["Sports"], occurredAt: NOW },
        { event: "not_interested", categories: ["True Crime"], occurredAt: NOW },
      ],
      [],
      NOW,
    );

    expect(affinity.get("Sports")!.weight).toBeLessThan(0);
    expect(affinity.get("True Crime")!.weight).toBeLessThan(
      affinity.get("Sports")!.weight,
    );
  });

  it("decays older signals toward half weight at the half-life", () => {
    const recent = buildAffinity(
      [{ event: "complete", categories: ["Tech"], occurredAt: NOW }],
      [],
      NOW,
    );
    const old = buildAffinity(
      [{ event: "complete", categories: ["Tech"], occurredAt: daysAgo(30) }],
      [],
      NOW,
    );

    expect(old.get("Tech")!.weight).toBeCloseTo(recent.get("Tech")!.weight / 2, 5);
  });

  it("counts subscriptions as their own kind of evidence", () => {
    const affinity = buildAffinity(
      [],
      [
        { categories: ["Comedy"], subscribedAt: NOW },
        { categories: ["Comedy"], subscribedAt: NOW },
      ],
      NOW,
    );

    expect(affinity.get("Comedy")!.subscriptions).toBe(2);
    expect(affinity.get("Comedy")!.weight).toBeGreaterThan(0);
  });

  it("accumulates counts across signal types for the same category", () => {
    const affinity = buildAffinity(
      [
        { event: "complete", categories: ["Tech"], occurredAt: NOW },
        { event: "complete", categories: ["Tech"], occurredAt: NOW },
        { event: "play_start", categories: ["Tech"], occurredAt: NOW },
      ],
      [{ categories: ["Tech"], subscribedAt: NOW }],
      NOW,
    );

    const entry = affinity.get("Tech")!;
    expect(entry).toMatchObject({ completes: 2, plays: 1, subscriptions: 1 });
  });
});

describe("inverseDocumentFrequency", () => {
  it("scores a rare category above a ubiquitous one", () => {
    const idf = inverseDocumentFrequency([
      candidate({ feedUrl: "a", categories: ["Society & Culture", "Chess"] }),
      candidate({ feedUrl: "b", categories: ["Society & Culture"] }),
      candidate({ feedUrl: "c", categories: ["Society & Culture"] }),
    ]);

    expect(idf.get("Chess")!).toBeGreaterThan(idf.get("Society & Culture")!);
  });

  it("does not double-count a category repeated within one show", () => {
    const idf = inverseDocumentFrequency([
      candidate({ feedUrl: "a", categories: ["Tech", "Tech", "Tech"] }),
      candidate({ feedUrl: "b", categories: ["News"] }),
    ]);

    expect(idf.get("Tech")).toBeCloseTo(idf.get("News")!);
  });
});

describe("scoreCandidate", () => {
  const affinity = buildAffinity(
    [{ event: "complete", categories: ["Technology"], occurredAt: NOW }],
    [],
    NOW,
  );

  it("scores a matching show above an unrelated one", () => {
    const idf = new Map([
      ["Technology", 1],
      ["Gardening", 1],
    ]);

    const match = scoreCandidate(
      candidate({ feedUrl: "a", categories: ["Technology"] }),
      affinity,
      idf,
    );
    const miss = scoreCandidate(
      candidate({ feedUrl: "b", categories: ["Gardening"] }),
      affinity,
      idf,
    );

    expect(match.score).toBeGreaterThan(miss.score);
    expect(miss.score).toBe(0);
  });

  it("does not let a show with many tags outrank a precise match", () => {
    // Cosine normalisation is what prevents category-stuffing from winning.
    const idf = new Map(
      ["Technology", "Arts", "News", "Sports", "Comedy"].map((c) => [c, 1] as const),
    );

    const precise = scoreCandidate(
      candidate({ feedUrl: "a", categories: ["Technology"] }),
      affinity,
      idf,
    );
    const stuffed = scoreCandidate(
      candidate({
        feedUrl: "b",
        categories: ["Technology", "Arts", "News", "Sports", "Comedy"],
      }),
      affinity,
      idf,
    );

    expect(precise.score).toBeGreaterThan(stuffed.score);
  });

  it("returns no score for a show with no categories", () => {
    expect(scoreCandidate(candidate({ feedUrl: "a" }), affinity, new Map())).toEqual({
      score: 0,
      reasons: [],
    });
  });

  it("attaches at most three reasons, strongest first", () => {
    const broad = buildAffinity(
      [
        { event: "complete", categories: ["A"], occurredAt: NOW },
        { event: "complete", categories: ["A"], occurredAt: NOW },
        { event: "complete", categories: ["B"], occurredAt: NOW },
        { event: "play_start", categories: ["C"], occurredAt: NOW },
        { event: "play_start", categories: ["D"], occurredAt: NOW },
      ],
      [],
      NOW,
    );

    const idf = new Map([["A", 1], ["B", 1], ["C", 1], ["D", 1]]);
    const { reasons } = scoreCandidate(
      candidate({ feedUrl: "x", categories: ["A", "B", "C", "D"] }),
      broad,
      idf,
    );

    expect(reasons).toHaveLength(3);
    expect(reasons[0].category).toBe("A");
  });
});

describe("describeReason", () => {
  it.each([
    [{ weight: 1, completes: 12, plays: 0, subscriptions: 0 }, "finished 12 Tech episodes"],
    [{ weight: 1, completes: 0, plays: 0, subscriptions: 3 }, "follow 3 Tech shows"],
    [{ weight: 1, completes: 0, plays: 0, subscriptions: 1 }, "follow a Tech show"],
    [{ weight: 1, completes: 1, plays: 0, subscriptions: 0 }, "finished a Tech episode"],
    [{ weight: 1, completes: 0, plays: 4, subscriptions: 0 }, "listening to Tech"],
  ])("describes %o in plain language", (entry, expected) => {
    expect(describeReason("Tech", entry)).toContain(expected);
  });
});

describe("rankCandidates", () => {
  const affinity = buildAffinity(
    [{ event: "complete", categories: ["Technology"], occurredAt: NOW }],
    [],
    NOW,
  );

  it("excludes shows already followed, ignoring case and whitespace", () => {
    const ranked = rankCandidates({
      candidates: [
        candidate({ feedUrl: "https://A.com/feed", categories: ["Technology"] }),
        candidate({ feedUrl: "https://b.com/feed", categories: ["Technology"] }),
      ],
      affinity,
      excludeFeedUrls: ["  https://a.com/FEED  "],
    });

    expect(ranked.map((r) => r.feedUrl)).toEqual(["https://b.com/feed"]);
  });

  it("drops candidates with nothing in common", () => {
    const ranked = rankCandidates({
      candidates: [candidate({ feedUrl: "a", categories: ["Gardening"] })],
      affinity,
    });

    expect(ranked).toEqual([]);
  });

  it("always attaches an explanation to everything it returns", () => {
    const ranked = rankCandidates({
      candidates: [
        candidate({ feedUrl: "a", categories: ["Technology"] }),
        candidate({ feedUrl: "b", categories: ["Technology", "News"] }),
      ],
      affinity,
    });

    expect(ranked.length).toBeGreaterThan(0);
    for (const r of ranked) expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("uses episode count only to break an exact tie", () => {
    const ranked = rankCandidates({
      candidates: [
        candidate({ feedUrl: "small", categories: ["Technology"], episodeCount: 5 }),
        candidate({ feedUrl: "big", categories: ["Technology"], episodeCount: 900 }),
      ],
      affinity,
    });

    expect(ranked[0].feedUrl).toBe("big");
  });

  it("does not let popularity beat a better category match", () => {
    const mixed = buildAffinity(
      [
        { event: "complete", categories: ["Chess"], occurredAt: NOW },
        { event: "complete", categories: ["Chess"], occurredAt: NOW },
      ],
      [],
      NOW,
    );

    const ranked = rankCandidates({
      candidates: [
        candidate({ feedUrl: "niche", categories: ["Chess"], episodeCount: 3 }),
        candidate({
          feedUrl: "popular",
          categories: ["Chess", "News", "Sports", "Comedy", "Arts"],
          episodeCount: 5000,
        }),
      ],
      affinity: mixed,
    });

    expect(ranked[0].feedUrl).toBe("niche");
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      candidate({ feedUrl: `f${i}`, categories: ["Technology"] }),
    );
    expect(rankCandidates({ candidates: many, affinity, limit: 5 })).toHaveLength(5);
  });
});

describe("topCategories", () => {
  it("returns the strongest positive categories in order", () => {
    const affinity = buildAffinity(
      [
        { event: "complete", categories: ["A"], occurredAt: NOW },
        { event: "complete", categories: ["A"], occurredAt: NOW },
        { event: "complete", categories: ["B"], occurredAt: NOW },
        { event: "skip", categories: ["C"], occurredAt: NOW },
      ],
      [],
      NOW,
    );

    expect(topCategories(affinity, 5)).toEqual(["A", "B"]);
  });
});
