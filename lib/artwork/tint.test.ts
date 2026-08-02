import { describe, expect, it } from "vitest";
import { channelsFromRgb, tintStyle } from "./tint";

/**
 * These exist because the failure they guard against is silent.
 *
 * `--tint-rgb` is interpolated straight into `rgb(var(--tint-rgb) / 0.16)`, so
 * a malformed value does not throw and does not fall back — it produces an
 * invalid colour, the declaration is dropped, and the hero renders with no wash
 * at all. Nothing logs. Returning null on anything unparseable is what makes
 * the CSS fallback actually reachable, so that path is the thing worth testing.
 */
describe("channelsFromRgb", () => {
  it("converts the palette's rgb() form to bare channels", () => {
    expect(channelsFromRgb("rgb(76, 72, 104)")).toBe("76 72 104");
  });

  it("tolerates the whitespace variations rgb() permits", () => {
    expect(channelsFromRgb("rgb(0,0,0)")).toBe("0 0 0");
    expect(channelsFromRgb("rgb(  12 ,  34 ,  56  )")).toBe("12 34 56");
  });

  it("returns null for a missing colour", () => {
    expect(channelsFromRgb(undefined)).toBeNull();
    expect(channelsFromRgb("")).toBeNull();
  });

  it("returns null for forms it cannot safely reinterpret", () => {
    // Each of these would otherwise reach CSS as something `rgb(… / a)` cannot
    // consume. Hex and named colours have no channels to split; rgba() carries
    // an alpha this system sets itself, per role, and must not inherit.
    expect(channelsFromRgb("#4c4868")).toBeNull();
    expect(channelsFromRgb("rebeccapurple")).toBeNull();
    expect(channelsFromRgb("rgba(76, 72, 104, 0.5)")).toBeNull();
    expect(channelsFromRgb("rgb(76 72 104)")).toBeNull();
  });

  it("rejects out-of-range channels rather than clamping them", () => {
    // A value above 255 means the input was not what this parser thinks it is,
    // so clamping would paint a confidently wrong colour. The fallback is the
    // accent, which is always a defensible answer.
    expect(channelsFromRgb("rgb(300, 0, 0)")).toBeNull();
  });
});

describe("tintStyle", () => {
  it("sets the custom property when a tint resolved", () => {
    expect(tintStyle("76 72 104")).toEqual({ "--tint-rgb": "76 72 104" });
  });

  it("returns nothing to spread when it did not, leaving the CSS fallback", () => {
    expect(tintStyle(null)).toEqual({});
  });
});
