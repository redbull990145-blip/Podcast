import { describe, expect, it } from "vitest";
import { isAboutPerson } from "./wikipedia";

describe("isAboutPerson", () => {
  it("accepts the article about the person searched for", () => {
    expect(
      isAboutPerson(
        "Raj Shamani",
        "Raj Shamani",
        "Raj Shamani is an Indian entrepreneur and podcaster. He is primarily known for hosting the business podcast Figuring Out with Raj Shamani.",
      ),
    ).toBe(true);
  });

  it("rejects the club Wikipedia returns when the person has no article", () => {
    // The real result for "Ranjit Bajaj": his club, described as a club.
    expect(
      isAboutPerson(
        "Ranjit Bajaj",
        "Minerva Academy FC",
        "Minerva Academy Football Club is an Indian professional football club based in Mohali/Chandigarh, Punjab.",
      ),
    ).toBe(false);
  });

  it("accepts a match stated only in the opening summary", () => {
    expect(
      isAboutPerson(
        "Kiel Harvey",
        "The Second Look",
        "The Second Look is a podcast written and presented by Kiel Harvey.",
      ),
    ).toBe(true);
  });

  it("ignores short connecting words when matching", () => {
    expect(
      isAboutPerson("Kiel F Harvey", "Kiel Harvey", "Kiel Harvey is a writer."),
    ).toBe(true);
  });

  it("rejects an article that shares only part of the name", () => {
    expect(
      isAboutPerson("Ranjit Bajaj", "Bajaj Auto", "Bajaj Auto is an Indian manufacturer."),
    ).toBe(false);
  });
});
