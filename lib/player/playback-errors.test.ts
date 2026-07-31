import { describe, expect, it } from "vitest";
import {
  audioHost,
  describeMediaError,
  MEDIA_ERR,
  undecodableMessage,
  unreachableMessage,
} from "./playback-errors";

describe("describeMediaError", () => {
  it("tells a listener whether retrying is worth it", () => {
    expect(describeMediaError(MEDIA_ERR.ABORTED)).toMatch(/press play/i);
    expect(describeMediaError(MEDIA_ERR.NETWORK)).toMatch(/try again/i);
    expect(describeMediaError(MEDIA_ERR.DECODE)).toMatch(/corrupted/i);
  });

  it("does not guess a cause for the ambiguous code", () => {
    // SRC_NOT_SUPPORTED covers both "can't decode it" and "never got it", so
    // this one has to wait for the host probe rather than pick a side.
    const message = describeMediaError(MEDIA_ERR.SRC_NOT_SUPPORTED);
    expect(message).not.toMatch(/format|codec/i);
    expect(message).toMatch(/checking/i);
  });

  it("stays useful for an unknown or missing code", () => {
    expect(describeMediaError(undefined)).toMatch(/wouldn't load/i);
    expect(describeMediaError(99)).toMatch(/wouldn't load/i);
  });
});

describe("audioHost", () => {
  it("pulls the hostname out of an enclosure url", () => {
    expect(audioHost("http://open.live.bbc.co.uk/mediaselector/6/redir/x.mp3")).toBe(
      "open.live.bbc.co.uk",
    );
    expect(audioHost("https://anchor.fm/s/123/podcast/play/1/x.m4a")).toBe("anchor.fm");
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(audioHost("not a url")).toBeNull();
    expect(audioHost("")).toBeNull();
  });
});

describe("unreachableMessage", () => {
  it("names the host, since that is the only actionable part", () => {
    const message = unreachableMessage("http://open.live.bbc.co.uk/x.mp3");
    expect(message).toContain("open.live.bbc.co.uk");
    // Says whose problem it is: the audio is not served by this app.
    expect(message).toMatch(/blocked by your network|down/i);
  });

  it("does not blame the audio format, which was never the issue", () => {
    expect(unreachableMessage("http://x.example/a.mp3")).not.toMatch(/format|codec/i);
  });

  it("still says something sensible when the url is unparseable", () => {
    expect(unreachableMessage("???")).toMatch(/couldn't reach/i);
  });
});

describe("undecodableMessage", () => {
  it("blames the format only when the file genuinely arrived", () => {
    expect(undecodableMessage()).toMatch(/format|codec/i);
  });
});
