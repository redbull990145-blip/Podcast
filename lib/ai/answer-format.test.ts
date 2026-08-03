import { describe, expect, it } from "vitest";
import { formatStamp, tokenizeAnswer, toSeconds } from "./answer-format";

describe("toSeconds", () => {
  it("reads m:ss and h:mm:ss", () => {
    expect(toSeconds("0:32")).toBe(32);
    expect(toSeconds("25:30")).toBe(1530);
    expect(toSeconds("1:21:03")).toBe(4863);
  });

  it("reads three-digit minutes literally, as minutes", () => {
    // What older answers meant by it, and the only reading the format
    // specifies — 171 minutes in, not a mangled 1:71:09.
    expect(toSeconds("171:09")).toBe(171 * 60 + 9);
  });
});

describe("formatStamp", () => {
  it("carries hours once there are any", () => {
    expect(formatStamp(32)).toBe("0:32");
    expect(formatStamp(1530)).toBe("25:30");
    expect(formatStamp(4863)).toBe("1:21:03");
    expect(formatStamp(10269)).toBe("2:51:09");
  });

  it("makes a bare minute count legible as a clock time", () => {
    expect(formatStamp(toSeconds("171:09"))).toBe("2:51:09");
  });
});

describe("tokenizeAnswer", () => {
  it("leaves plain prose alone", () => {
    expect(tokenizeAnswer("Just a sentence.")).toEqual([
      { kind: "text", text: "Just a sentence." },
    ]);
  });

  it("lifts bold out rather than showing the asterisks", () => {
    expect(tokenizeAnswer("- **Historical Parallels:** India was once strong")).toEqual([
      { kind: "text", text: "- " },
      { kind: "bold", text: "Historical Parallels:" },
      { kind: "text", text: " India was once strong" },
    ]);
  });

  it("turns a timestamp into a seekable citation", () => {
    expect(tokenizeAnswer("He says so [26:52].")).toEqual([
      { kind: "text", text: "He says so " },
      { kind: "cite", text: "26:52", at: 1612 },
      { kind: "text", text: "." },
    ]);
  });

  it("handles bold and citations in the same answer", () => {
    const tokens = tokenizeAnswer("**Club Ownership:** Minerva sells talent [34:53].");
    expect(tokens.map((t) => t.kind)).toEqual(["bold", "text", "cite", "text"]);
  });

  it("relabels a citation without moving where it seeks", () => {
    const [cite] = tokenizeAnswer("[171:09]") as [
      { kind: "cite"; text: string; at: number },
    ];
    expect(cite).toEqual({ kind: "cite", text: "2:51:09", at: 171 * 60 + 9 });
  });

  it("does not treat a source label as a citation", () => {
    // The model was told never to write these, but a stray one must render as
    // text rather than as a button that seeks to nowhere.
    expect(tokenizeAnswer("a host [Show description]")).toEqual([
      { kind: "text", text: "a host [Show description]" },
    ]);
  });

  it("lifts italics out too — models italicize show names", () => {
    expect(tokenizeAnswer("hosts the podcast *Figuring Out*, where he")).toEqual([
      { kind: "text", text: "hosts the podcast " },
      { kind: "italic", text: "Figuring Out" },
      { kind: "text", text: ", where he" },
    ]);
  });

  it("does not read arithmetic as emphasis", () => {
    expect(tokenizeAnswer("2 * 3 is 6")).toEqual([{ kind: "text", text: "2 * 3 is 6" }]);
    expect(tokenizeAnswer("a * b * c")).toEqual([{ kind: "text", text: "a * b * c" }]);
  });

  it("prefers bold over italics when both could match", () => {
    expect(tokenizeAnswer("**Club Ownership:**")).toEqual([
      { kind: "bold", text: "Club Ownership:" },
    ]);
  });

  it("keeps a partial bold run intact while the answer is still streaming", () => {
    // Mid-stream the closing asterisks have not arrived yet; showing the text
    // beats swallowing it until they do.
    expect(tokenizeAnswer("**Club Owners")).toEqual([
      { kind: "text", text: "**Club Owners" },
    ]);
  });
});
