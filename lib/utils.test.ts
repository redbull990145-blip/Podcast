import { describe, expect, it } from "vitest";
import { stripHtml } from "./utils";

describe("stripHtml", () => {
  it("decodes the typographic entities a CMS actually emits", () => {
    expect(stripHtml("In &ldquo;I Caught A Thought,&rdquo; Pastor Steven")).toBe(
      "In “I Caught A Thought,” Pastor Steven",
    );
    expect(stripHtml("it&rsquo;s here &mdash; really")).toBe("it’s here — really");
    expect(stripHtml("and so on&hellip;")).toBe("and so on…");
  });

  it("does not decode an entity twice", () => {
    // "&amp;lt;" is a correctly escaped literal "&lt;". Decoding the ampersand
    // first would turn it into "<" — text becoming markup.
    expect(stripHtml("&amp;lt;script&amp;gt;")).toBe("&lt;script&gt;");
    expect(stripHtml("Tom &amp; Jerry")).toBe("Tom & Jerry");
  });

  it("handles numeric entities in both bases", () => {
    expect(stripHtml("&#39;quoted&#39;")).toBe("'quoted'");
    expect(stripHtml("&#x27;quoted&#x27;")).toBe("'quoted'");
    expect(stripHtml("caf&#233;")).toBe("café");
  });

  it("leaves malformed or unknown entities as written", () => {
    expect(stripHtml("100&nope; of them")).toBe("100&nope; of them");
    expect(stripHtml("&#xD800;")).toBe("&#xD800;");
    expect(stripHtml("50% &amp; rising")).toBe("50% & rising");
  });

  it("turns block markup into line breaks and drops the rest", () => {
    expect(stripHtml("<p>One</p><p>Two</p>")).toBe("One\n\nTwo");
    expect(stripHtml("a<br>b")).toBe("a\nb");
    expect(stripHtml('<a href="https://x.test">link</a>')).toBe("link");
  });

  it("collapses runs of blank lines and trims", () => {
    expect(stripHtml("<p>A</p><p></p><p>B</p>  ")).toBe("A\n\nB");
  });

  it("is safe on empty input", () => {
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
    expect(stripHtml("")).toBe("");
  });
});
