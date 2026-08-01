import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultLlmChain, isDefaultTierAvailable } from "./config";

/**
 * The chain is built from the environment, so these set it directly rather
 * than mocking — the thing under test is precisely how env vars turn into an
 * ordered list of providers.
 */
const KEYS = [
  "GEMINI_API_KEY",
  "NVIDIA_API_KEY",
  "OPENROUTER_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_PROVIDER_ORDER",
  "AI_DEFAULT_PROVIDER",
  "AI_GEMINI_MODELS",
  "AI_NVIDIA_MODELS",
  "AI_OPENROUTER_MODELS",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("defaultLlmChain", () => {
  it("is empty when nothing is configured", () => {
    expect(defaultLlmChain()).toEqual([]);
    expect(isDefaultTierAvailable()).toBe(false);
  });

  it("includes every provider that has a key, not just the first", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.NVIDIA_API_KEY = "n";
    process.env.OPENROUTER_API_KEY = "o";

    expect(defaultLlmChain().map((c) => c.provider)).toEqual([
      "gemini",
      "nvidia",
      "openrouter",
    ]);
  });

  it("skips providers with no key rather than leaving a hole", () => {
    process.env.NVIDIA_API_KEY = "n";
    process.env.OPENAI_API_KEY = "p";

    expect(defaultLlmChain().map((c) => c.provider)).toEqual(["nvidia", "openai"]);
  });

  it("puts free tiers ahead of paid ones by default", () => {
    for (const k of KEYS.filter((k) => k.endsWith("_API_KEY"))) process.env[k] = "x";
    const order = defaultLlmChain().map((c) => c.provider);

    expect(order.indexOf("gemini")).toBeLessThan(order.indexOf("deepseek"));
    expect(order.indexOf("nvidia")).toBeLessThan(order.indexOf("openai"));
  });

  it("honours AI_PROVIDER_ORDER", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.NVIDIA_API_KEY = "n";
    process.env.AI_PROVIDER_ORDER = "nvidia,gemini";

    expect(defaultLlmChain().map((c) => c.provider)).toEqual(["nvidia", "gemini"]);
  });

  it("treats AI_PROVIDER_ORDER as an allowlist too", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.OPENROUTER_API_KEY = "o";
    process.env.AI_PROVIDER_ORDER = "gemini";

    // OpenRouter has a key but was left out, so it must not be used.
    expect(defaultLlmChain().map((c) => c.provider)).toEqual(["gemini"]);
  });

  it("ignores unknown names in AI_PROVIDER_ORDER", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.AI_PROVIDER_ORDER = "not-a-provider, gemini";

    expect(defaultLlmChain().map((c) => c.provider)).toEqual(["gemini"]);
  });

  it("treats AI_DEFAULT_PROVIDER as first-not-only", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.NVIDIA_API_KEY = "n";
    process.env.AI_DEFAULT_PROVIDER = "nvidia";

    // The regression this guards: naming one provider used to exclude the rest,
    // so hitting its limit failed the request with other keys sitting unused.
    expect(defaultLlmChain().map((c) => c.provider)).toEqual(["nvidia", "gemini"]);
  });

  it("does not disable AI when AI_DEFAULT_PROVIDER names a keyless provider", () => {
    process.env.AI_DEFAULT_PROVIDER = "gemini";
    process.env.OPENROUTER_API_KEY = "o";

    expect(defaultLlmChain().map((c) => c.provider)).toEqual(["openrouter"]);
    expect(isDefaultTierAvailable()).toBe(true);
  });

  it("carries a non-empty model chain and a matching head for each provider", () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.NVIDIA_API_KEY = "n";

    for (const config of defaultLlmChain()) {
      expect(config.models.length).toBeGreaterThan(0);
      expect(config.model).toBe(config.models[0]);
      expect(config.baseUrl).toMatch(/^https:\/\//);
      expect(config.apiKey).not.toBe("");
    }
  });

  it("lets a model chain be overridden per provider", () => {
    process.env.NVIDIA_API_KEY = "n";
    process.env.AI_NVIDIA_MODELS = "meta/llama-3.1-8b-instruct, ibm/granite-3.0-8b-instruct";

    const [nvidia] = defaultLlmChain();
    expect(nvidia.models).toEqual([
      "meta/llama-3.1-8b-instruct",
      "ibm/granite-3.0-8b-instruct",
    ]);
    expect(nvidia.model).toBe("meta/llama-3.1-8b-instruct");
  });
});
