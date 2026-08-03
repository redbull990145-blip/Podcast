import { describe, expect, it } from "vitest";
import { episodePeople, peopleAskedAbout } from "./people";

const FO528 =
  "FIFA World Cup, Football Corruption, ISL & Talent System | Ranjit Bajaj | FO528 Raj Shamani";

describe("episodePeople", () => {
  it("finds the guest and host in a real episode title", () => {
    const people = episodePeople("Raj Shamani", FO528);
    expect(people).toContain("Ranjit Bajaj");
    expect(people).toContain("Raj Shamani");
  });

  it("ignores acronyms and codes that are not names", () => {
    const people = episodePeople("Raj Shamani", FO528);
    expect(people).not.toContain("FIFA World Cup");
    expect(people).not.toContain("ISL");
    expect(people.some((p) => p.includes("FO528"))).toBe(false);
  });

  it("splits a feed that credits more than one host", () => {
    expect(episodePeople("Chelle and Sam", "Some Episode")).toEqual(
      expect.arrayContaining(["Chelle", "Sam"]),
    );
    expect(episodePeople("Tom & Jerry", "Some Episode")).toEqual(
      expect.arrayContaining(["Tom", "Jerry"]),
    );
  });

  it("copes with a feed that credits nobody", () => {
    expect(() => episodePeople(null, FO528)).not.toThrow();
    expect(episodePeople(null, FO528)).toContain("Ranjit Bajaj");
  });
});

describe("peopleAskedAbout", () => {
  const people = episodePeople("Raj Shamani", FO528);

  it("matches however the listener capitalized it", () => {
    expect(peopleAskedAbout("Who is Ranjit bajaj and Raj shamani?", people)).toEqual(
      expect.arrayContaining(["Ranjit Bajaj", "Raj Shamani"]),
    );
  });

  it("matches a surname on its own", () => {
    expect(peopleAskedAbout("tell me about Bajaj", people)).toContain("Ranjit Bajaj");
  });

  it("looks nothing up for a question about the episode's content", () => {
    expect(peopleAskedAbout("Give me the three-line version", people)).toEqual([]);
    expect(peopleAskedAbout("What did Bajaj say about the AIFF?", people)).toEqual([]);
  });

  it("looks nothing up for a person this episode is not about", () => {
    // The guard that stops a grounding feature becoming a search engine.
    expect(peopleAskedAbout("Who is Elon Musk?", people)).toEqual([]);
  });

  it("does not match a surname buried inside another word", () => {
    expect(peopleAskedAbout("who is the maharaja", ["Raj Shamani"])).toEqual([]);
  });
});
