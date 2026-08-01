import { beforeEach, describe, expect, it } from "vitest";
import {
  assertMasked,
  clearShaderCache,
  composeFragment,
  type ShaderModule,
} from "./compose";
import { MAX_MODULES } from "../types";

const light: ShaderModule = {
  id: "LIGHT_DRIFT",
  tone: "lab = addLightness(lab, W * 0.02);",
};

const breath: ShaderModule = {
  id: "BREATH",
  tone: "lab = addLightness(lab, W * sin(time));",
};

const depth: ShaderModule = {
  id: "DEPTH_BAND",
  displace: "offset += vec2(0.001, 0.0) * W * freedom;",
};

beforeEach(clearShaderCache);

describe("composeFragment", () => {
  it("compiles nothing but the shared core when no modules are asked for", () => {
    const source = composeFragment([]);

    expect(source).toContain("srgbToOklab");
    expect(source).toContain("clampDeviation");
    expect(source).toContain("no displacing modules");
    expect(source).toContain("no tone modules");
  });

  it("leaves out modules the profile did not ask for", () => {
    // The reason a profile is a module list rather than a set of weights on one
    // big shader: an unused effect costs no arithmetic because it is not there.
    const source = composeFragment([light]);

    expect(source).toContain("LIGHT_DRIFT");
    expect(source).not.toContain("BREATH");
    expect(source).not.toContain("offset +=");
  });

  it("gives each module its own weight slot, in the order listed", () => {
    const source = composeFragment([light, breath]);

    expect(source).toContain("uWeights[0] * uIntensity");
    expect(source).toContain("uWeights[1] * uIntensity");
  });

  it("scopes each module so two cannot collide over a name", () => {
    const a: ShaderModule = { id: "GLOW", tone: "float t = 1.0; lab.x += t * W;" };
    const b: ShaderModule = { id: "SHADOW", tone: "float t = 2.0; lab.x -= t * W;" };

    // Both declare `t`. A module author should not have to know what else is in
    // the shader alongside them.
    const source = composeFragment([a, b]);
    expect(source.match(/float t = /g)).toHaveLength(2);
  });

  it("declares its own fragment output", () => {
    // Three declares one for GLSL1 shaders but not for GLSL3 ShaderMaterials —
    // verified against WebGLProgram.js, which emits the `pc_fragColor`
    // declaration only when glslVersion is *not* GLSL3.
    expect(composeFragment([])).toContain("out vec4 fragColor;");
  });

  it("returns the identical string for the same module set, so three reuses the program", () => {
    clearShaderCache();
    const first = composeFragment([light, breath]);
    clearShaderCache();
    const second = composeFragment([light, breath]);

    expect(second).toBe(first);
  });

  it("memoises", () => {
    expect(composeFragment([light])).toBe(composeFragment([light]));
  });

  it("refuses more modules than the weights array can hold", () => {
    const many = Array.from({ length: MAX_MODULES + 1 }, () => light);
    expect(() => composeFragment(many)).toThrow(/at most/);
  });

  it("skips the second texture fetch when nothing displaced", () => {
    // A profile with no displacing modules should not pay for a second sample
    // of the same texel.
    expect(composeFragment([light])).toContain("offset == vec2(0.0) ? srcLab");
  });
});

describe("assertMasked", () => {
  it("accepts a displacing module that gates on the mask", () => {
    expect(() => assertMasked([depth])).not.toThrow();
  });

  it("rejects a displacing module that does not", () => {
    // The rule this enforces is the whole "do not distort typography"
    // guarantee. Forgetting it is not a subtle bug, so it fails at import
    // rather than waiting to be noticed on somebody's cover.
    const ungated: ShaderModule = {
      id: "SURFACE",
      displace: "offset += vec2(0.002, 0.0) * W;",
    };

    expect(() => assertMasked([ungated])).toThrow(/must multiply by the protection mask/);
  });

  it("has nothing to say about modules that cannot displace", () => {
    expect(() => assertMasked([light, breath])).not.toThrow();
  });
});
