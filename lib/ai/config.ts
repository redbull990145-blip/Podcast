/**
 * AI provider configuration.
 *
 * Two tiers:
 *  - "default": funded by the operator's own keys, capped by a daily per-user
 *    quota. This is what every user gets without doing anything.
 *  - "byok": the user supplied their own key, so there is no quota and the
 *    call is billed to them.
 *
 * All providers below speak the OpenAI chat-completions wire format, so one
 * client covers them and switching is a base-URL and model change.
 */

export type AiTier = "default" | "byok";

export type LlmProvider = "openrouter" | "deepseek" | "openai" | "anthropic";
export type SttProvider = "groq" | "openai";

export type LlmConfig = {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type SttConfig = {
  provider: SttProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
};

const LLM_ENDPOINTS: Record<LlmProvider, { baseUrl: string; defaultModel: string }> = {
  // Free-tier models during development.
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat-v3.1:free",
  },
  // Cheap enough per token to fund the free tier at launch.
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5-20251001",
  },
};

const STT_ENDPOINTS: Record<SttProvider, { baseUrl: string; defaultModel: string }> = {
  // Groq runs Whisper on LPUs — far faster than real time, and has a free tier,
  // which is what makes operator-funded transcription viable at all.
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "whisper-large-v3-turbo",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "whisper-1",
  },
};

/** Which provider the operator-funded tier uses. Set by AI_DEFAULT_PROVIDER. */
function defaultLlmProvider(): LlmProvider {
  const configured = process.env.AI_DEFAULT_PROVIDER?.toLowerCase();
  return configured === "deepseek" ? "deepseek" : "openrouter";
}

/** Resolves the LLM config for the operator-funded tier, or null if unconfigured. */
export function defaultLlmConfig(): LlmConfig | null {
  const provider = defaultLlmProvider();
  const apiKey =
    provider === "deepseek"
      ? process.env.DEEPSEEK_API_KEY
      : process.env.OPENROUTER_API_KEY;

  if (!apiKey) return null;

  const endpoint = LLM_ENDPOINTS[provider];
  return {
    provider,
    baseUrl: endpoint.baseUrl,
    model: process.env.AI_DEFAULT_MODEL || endpoint.defaultModel,
    apiKey,
  };
}

/** Resolves the speech-to-text config for the operator-funded tier. */
export function defaultSttConfig(): SttConfig | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const endpoint = STT_ENDPOINTS.groq;
  return {
    provider: "groq",
    baseUrl: endpoint.baseUrl,
    model: process.env.AI_STT_MODEL || endpoint.defaultModel,
    apiKey,
  };
}

/** Builds an LLM config from a user's own key. */
export function byokLlmConfig(provider: LlmProvider, apiKey: string): LlmConfig {
  const endpoint = LLM_ENDPOINTS[provider];
  return { provider, baseUrl: endpoint.baseUrl, model: endpoint.defaultModel, apiKey };
}

/** Builds a speech-to-text config from a user's own key. */
export function byokSttConfig(provider: SttProvider, apiKey: string): SttConfig {
  const endpoint = STT_ENDPOINTS[provider];
  return { provider, baseUrl: endpoint.baseUrl, model: endpoint.defaultModel, apiKey };
}

/** True when the operator has configured enough for the free tier to work. */
export function isDefaultTierAvailable(): boolean {
  return defaultLlmConfig() !== null;
}

export function isDefaultTranscriptionAvailable(): boolean {
  return defaultSttConfig() !== null;
}

/** Daily allowances for the operator-funded tier. Tunable without a deploy. */
export function dailyQuota() {
  return {
    /** Expensive work: transcription, summaries, chapter generation. */
    jobs: Number(process.env.AI_DAILY_FREE_JOBS ?? 5),
    /** Cheap follow-up questions against an already-cached transcript. */
    qa: Number(process.env.AI_DAILY_FREE_QA ?? 20),
  };
}
