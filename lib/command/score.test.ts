import { describe, expect, it } from "vitest";
import { NO_MATCH, scoreCommand } from "./score";

describe("scoreCommand", () => {
  it("shows everything when nothing has been typed", () => {
    expect(scoreCommand("Library", "")).toBeGreaterThan(NO_MATCH);
    expect(scoreCommand("Library", "   ")).toBeGreaterThan(NO_MATCH);
  });

  it("ranks a prefix above a word prefix above a mid-word match", () => {
    const prefix = scoreCommand("Daily Show", "daily");
    const wordPrefix = scoreCommand("The Daily", "daily");
    const midWord = scoreCommand("Updaily", "daily");

    expect(prefix).toBeGreaterThan(wordPrefix);
    expect(wordPrefix).toBeGreaterThan(midWord);
    expect(midWord).toBeGreaterThan(NO_MATCH);
  });

  it("treats title punctuation as a word boundary", () => {
    // Show titles are full of these, and a colon or an en dash separates words
    // every bit as much as a space does.
    for (const title of ["News: Daily Edition", "Up-Daily", "News—Daily", "(Daily)"]) {
      expect(scoreCommand(title, "daily")).toBe(scoreCommand("The Daily", "daily"));
    }
  });

  it("is case- and accent-insensitive", () => {
    expect(scoreCommand("Café Society", "cafe")).toBe(scoreCommand("Cafe Society", "cafe"));
    expect(scoreCommand("CAFÉ SOCIETY", "café")).toBeGreaterThan(NO_MATCH);
  });

  it("matches keywords, but ranks them below anything visible", () => {
    const viaKeyword = scoreCommand("Up Next", "queue", ["queue", "playlist"]);
    const viaLabel = scoreCommand("Queue something", "queue");

    expect(viaKeyword).toBeGreaterThan(NO_MATCH);
    expect(viaLabel).toBeGreaterThan(viaKeyword);
  });

  it("does not fuzzy-match short queries", () => {
    // The point of the floor: without it, "ai" subsequence-matches most long
    // titles in a library and the palette looks like it is guessing.
    expect(scoreCommand("Accidental Tech Podcast", "ai")).toBe(NO_MATCH);
    expect(scoreCommand("Reply All", "ay")).toBe(NO_MATCH);
  });

  it("allows subsequence matching once a query is long enough", () => {
    const fuzzy = scoreCommand("Accidental Tech Podcast", "atp");
    expect(fuzzy).toBeGreaterThan(NO_MATCH);

    // ...but never above a real contiguous match, which is the ordering the
    // whole scale exists to guarantee.
    expect(scoreCommand("ATP News", "atp")).toBeGreaterThan(fuzzy);
  });

  it("returns no match when the letters are absent", () => {
    expect(scoreCommand("The Daily", "zzz")).toBe(NO_MATCH);
  });

  it("returns no match when the letters are present but out of order", () => {
    // "reply all" contains l, p and r, but never in that order — which is the
    // distinction subsequence matching is supposed to make and the reason it is
    // safe to keep at the bottom of the scale rather than removing it.
    expect(scoreCommand("Reply All", "lpr")).toBe(NO_MATCH);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(scoreCommand("Downloads", "  downloads  ")).toBe(
      scoreCommand("Downloads", "downloads"),
    );
  });
});
