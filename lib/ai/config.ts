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
export type SttProvider = "groq" | "openai" | "colab";

export type LlmConfig = {
  provider: LlmProvider;
  baseUrl: string;
  /** Primary model — used for display/logging (e.g. "openrouter/gpt-oss-20b:free"). */
  model: string;
  /**
   * Fallback chain tried in order. OpenRouter's free-variant models each carry
   * their own separate rate limit, so when one is exhausted the next in this
   * list is tried automatically rather than failing the request. Single-entry
   * for providers where "the free tier" isn't a moving target.
   */
  models: string[];
  apiKey: string;
};

export type SttConfig = {
  provider: SttProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  /**
   * Overrides the 25MB-per-request cap assumed for hosted providers.
   *
   * That cap is Groq's own limit, not a property of the wire format — a model
   * running on hardware you control has no such ceiling, so a local endpoint
   * sets this much higher and the existing whole-file-vs-chunk branch in
   * transcribe.ts naturally never chunks for it.
   */
  maxUploadBytes?: number;
  /**
   * How long one transcription request may take before being abandoned.
   *
   * The default suits a hosted provider answering faster than real time. A
   * self-hosted model does not: a consumer GPU running whisper-large is
   * perhaps ten times real time, so even a single chunk is tens of seconds.
   */
  requestTimeoutMs?: number;
  /** How much audio to put in one chunk. Defaults to the hosted-provider size. */
  chunkTargetBytes?: number;
  /** How many chunks may be in flight at once. Defaults to the hosted value. */
  concurrency?: number;
  /** How long the whole multi-chunk job may run. Defaults to the hosted value. */
  jobDeadlineMs?: number;
  /** How often to poll a local server's job endpoint. Local providers only. */
  pollIntervalMs?: number;
};

/**
 * Best-guess API slugs for OpenRouter's currently free-variant models, ordered
 * by general-purpose quality for summarization/Q&A. OpenRouter's free catalogue
 * rotates and the display name shown in their UI is not always the exact API
 * id — if a call 404s on "model not found", open the model's page at
 * openrouter.ai/models, copy the id shown there (format org/name:free), and
 * override this list via AI_OPENROUTER_MODELS (comma-separated) in .env.local.
 */
const DEFAULT_OPENROUTER_FREE_MODELS = [
  "openai/gpt-oss-20b:free",
  "google/gemma-4-31b:free",
  "google/gemma-4-26b-a4b:free",
  "nvidia/nemotron-3-super:free",
  "nvidia/nemotron-3-ultra:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
];

function openrouterModelChain(): string[] {
  const override = process.env.AI_OPENROUTER_MODELS?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return override && override.length > 0 ? override : DEFAULT_OPENROUTER_FREE_MODELS;
}

const LLM_ENDPOINTS: Record<LlmProvider, { baseUrl: string; defaultModel: string }> = {
  // Free-tier models during development. See openrouterModelChain() for the
  // full fallback list actually used — this single default is only the
  // provider-level fallback for byokLlmConfig, where there is no quota
  // pressure pushing between models.
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: DEFAULT_OPENROUTER_FREE_MODELS[0],
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

/** A hosted STT provider with a fixed endpoint. Excludes "colab", whose URL is
 * a per-developer env var rather than anything fixed in code. */
export type HostedSttProvider = Exclude<SttProvider, "colab">;

const STT_ENDPOINTS: Record<HostedSttProvider, { baseUrl: string; defaultModel: string }> = {
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
  const models =
    provider === "openrouter"
      ? openrouterModelChain()
      : [process.env.AI_DEFAULT_MODEL || endpoint.defaultModel];

  return {
    provider,
    baseUrl: endpoint.baseUrl,
    model: models[0],
    models,
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

/**
 * Resolves a local Whisper server for development, or null when none is set.
 *
 * This is not a tier a user opts into — it is a transport preference read
 * straight from the environment, meant for a developer running their own
 * model (e.g. faster-whisper in a Colab notebook, tunnelled with cloudflared)
 * instead of spending the shared Groq quota while iterating. The tunnel URL
 * is ephemeral — it changes every time the notebook restarts — which is why
 * this is a plain env var edited in .env.local rather than anything stored
 * or exposed in the UI.
 *
 * COLAB_SHARED_SECRET is optional: without it the notebook is expected to
 * accept requests unauthenticated, trusting the tunnel URL's unguessable
 * randomness as the only barrier. Set it on both sides for a real check.
 */
export function colabSttConfig(): SttConfig | null {
  const baseUrl = process.env.COLAB_WHISPER_URL?.replace(/\/+$/, "");
  if (!baseUrl) return null;

  return {
    provider: "colab",
    baseUrl,
    model: process.env.COLAB_WHISPER_MODEL || "whisper",
    apiKey: process.env.COLAB_SHARED_SECRET ?? "",
    /*
     * The local server is handed a URL and polled, never uploaded to, so none
     * of the chunking knobs apply — see transcribeViaLocalServer.
     *
     * That indirection exists because proxying the audio was the bottleneck:
     * a Cloudflare quick tunnel abandons any request unanswered after ~100
     * seconds, so a three-hour episode had to go up in forty-odd pieces, each
     * one first downloaded to this machine and then uploaded again. It was
     * slow, and it hammered the podcast host with dozens of range requests
     * until one of them was refused. Colab fetching the file itself, once,
     * from Google's network is faster than either leg of that round trip.
     */
    requestTimeoutMs: Number(process.env.COLAB_TIMEOUT_MS ?? 30_000),
    /*
     * How long to keep polling before giving up on the whole episode.
     *
     * A three-hour show is a few minutes of GPU work at whisper-medium's
     * batched throughput, so this is generous rather than tight — the point
     * is to stop waiting on a notebook that has died, not to cap useful work.
     */
    jobDeadlineMs: Number(process.env.COLAB_JOB_DEADLINE_MS ?? 40 * 60_000),
    pollIntervalMs: Number(process.env.COLAB_POLL_INTERVAL_MS ?? 3_000),
  };
}

/** Builds an LLM config from a user's own key. */
export function byokLlmConfig(provider: LlmProvider, apiKey: string): LlmConfig {
  const endpoint = LLM_ENDPOINTS[provider];
  // A user's own key is billed to them, so there's no reason to hop between
  // free-tier models — always their provider's normal default.
  return {
    provider,
    baseUrl: endpoint.baseUrl,
    model: endpoint.defaultModel,
    models: [endpoint.defaultModel],
    apiKey,
  };
}

/** Builds a speech-to-text config from a user's own key. */
export function byokSttConfig(provider: HostedSttProvider, apiKey: string): SttConfig {
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
