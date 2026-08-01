import { describe, expect, it } from "vitest";
import {
  completedBetween,
  computeStreak,
  dailyBreakdown,
  formatBytes,
  formatHours,
  topCategories,
  totalSeconds,
  type ListenedRow,
} from "./summarise";

const NOW = new Date("2026-03-12T18:00:00.000Z");
const DAY_MS = 86_400_000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

function row(overrides: Partial<ListenedRow> = {}): ListenedRow {
  return {
    lastPlayedAt: daysAgo(1),
    positionSeconds: 600,
    durationSeconds: 3600,
    played: false,
    categories: ["Documentary"],
    ...overrides,
  };
}

describe("dailyBreakdown", () => {
  it("returns a full week even when most days are empty", () => {
    const buckets = dailyBreakdown([row({ lastPlayedAt: daysAgo(2) })], NOW);

    expect(buckets).toHaveLength(7);
    expect(buckets.filter((b) => b.seconds > 0)).toHaveLength(1);
  });

  it("runs oldest first, ending today", () => {
    const buckets = dailyBreakdown([], NOW);

    expect(buckets[0].date).toBe("2026-03-06");
    expect(buckets.at(-1)!.date).toBe("2026-03-12");
  });

  it("credits a finished episode its whole duration, not its position", () => {
    const [bucket] = dailyBreakdown(
      [row({ lastPlayedAt: NOW, played: true, positionSeconds: 10, durationSeconds: 3600 })],
      NOW,
    ).slice(-1);

    expect(bucket.seconds).toBe(3600);
  });

  it("falls back to position when the feed omits a duration", () => {
    const [bucket] = dailyBreakdown(
      [row({ lastPlayedAt: NOW, played: true, positionSeconds: 900, durationSeconds: null })],
      NOW,
    ).slice(-1);

    expect(bucket.seconds).toBe(900);
  });

  it("ignores rows outside the window", () => {
    const buckets = dailyBreakdown([row({ lastPlayedAt: daysAgo(30) })], NOW);

    expect(buckets.every((b) => b.seconds === 0)).toBe(true);
  });
});

describe("totalSeconds", () => {
  it("sums only what falls inside the window", () => {
    const rows = [
      row({ lastPlayedAt: daysAgo(1), positionSeconds: 1000 }),
      row({ lastPlayedAt: daysAgo(9), positionSeconds: 5000 }),
    ];

    expect(totalSeconds(rows, NOW, 7)).toBe(1000);
    expect(totalSeconds(rows, NOW, 14)).toBe(6000);
  });

  it("treats a negative or non-finite position as nothing listened", () => {
    const rows = [
      row({ positionSeconds: -50, durationSeconds: null }),
      row({ positionSeconds: Number.NaN, durationSeconds: null }),
    ];

    expect(totalSeconds(rows, NOW)).toBe(0);
  });
});

describe("completedBetween", () => {
  const rows = [
    row({ played: true, lastPlayedAt: daysAgo(1) }),
    row({ played: true, lastPlayedAt: daysAgo(3) }),
    row({ played: true, lastPlayedAt: daysAgo(10) }),
    row({ played: false, lastPlayedAt: daysAgo(2) }),
  ];

  it("counts finished episodes in the last week", () => {
    expect(completedBetween(rows, NOW, 7, 0)).toBe(2);
  });

  it("counts the week before without double-counting this one", () => {
    expect(completedBetween(rows, NOW, 14, 7)).toBe(1);
  });
});

describe("topCategories", () => {
  it("ranks by time rather than by episode count", () => {
    const rows = [
      row({ categories: ["Comedy"], played: true, durationSeconds: 600 }),
      row({ categories: ["Comedy"], played: true, durationSeconds: 600 }),
      row({ categories: ["Comedy"], played: true, durationSeconds: 600 }),
      row({ categories: ["Documentary"], played: true, durationSeconds: 7200 }),
    ];

    expect(topCategories(rows, NOW)[0].name).toBe("Documentary");
  });

  it("gives each of a show's categories the full weight", () => {
    const rows = [row({ categories: ["Design", "Cities"], played: true, durationSeconds: 1800 })];
    const [first, second] = topCategories(rows, NOW);

    expect(first.seconds).toBe(1800);
    expect(second.seconds).toBe(1800);
  });

  it("reports shares relative to the leader", () => {
    const rows = [
      row({ categories: ["Documentary"], played: true, durationSeconds: 4000 }),
      row({ categories: ["Science"], played: true, durationSeconds: 1000 }),
    ];
    const ranked = topCategories(rows, NOW);

    expect(ranked[0].share).toBe(1);
    expect(ranked[1].share).toBe(0.25);
  });

  it("skips blank tags rather than ranking an empty string", () => {
    const rows = [row({ categories: ["", "  ", "Science"], played: true, durationSeconds: 600 })];

    expect(topCategories(rows, NOW).map((c) => c.name)).toEqual(["Science"]);
  });

  it("returns nothing when there is no listening in the window", () => {
    expect(topCategories([row({ lastPlayedAt: daysAgo(20) })], NOW)).toEqual([]);
  });
});

describe("computeStreak", () => {
  it("counts back from today", () => {
    expect(computeStreak([daysAgo(0), daysAgo(1), daysAgo(2)], NOW)).toBe(3);
  });

  it("survives a today with no listening yet", () => {
    expect(computeStreak([daysAgo(1), daysAgo(2)], NOW)).toBe(2);
  });

  it("stops at the first missed day", () => {
    expect(computeStreak([daysAgo(1), daysAgo(2), daysAgo(4)], NOW)).toBe(2);
  });

  it("counts several plays on one day once", () => {
    const sameDay = [
      new Date("2026-03-11T08:00:00.000Z"),
      new Date("2026-03-11T21:30:00.000Z"),
    ];

    expect(computeStreak(sameDay, NOW)).toBe(1);
  });

  it("is zero with no history, and zero once the gap reaches two days", () => {
    expect(computeStreak([], NOW)).toBe(0);
    expect(computeStreak([daysAgo(2)], NOW)).toBe(0);
  });
});

describe("formatting", () => {
  it("renders hours to one decimal", () => {
    expect(formatHours(45_240)).toBe("12.6");
    expect(formatHours(0)).toBe("0.0");
  });

  it("switches from megabytes to gigabytes at a thousand", () => {
    expect(formatBytes(94_000_000)).toBe("94 MB");
    expect(formatBytes(1_200_000_000)).toBe("1.2 GB");
    expect(formatBytes(0)).toBe("0 MB");
  });
});
