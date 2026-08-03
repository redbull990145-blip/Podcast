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

export type LlmProvider =
  | "gemini"
  | "nvidia"
  | "openrouter"
  | "deepseek"
  | "openai"
  | "anthropic";
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
  /**
   * True when this config spends the operator's key rather than the user's, and
   * therefore has to be counted against their daily allowance if it answers.
   *
   * A chain can now contain both — a user's own key first, the operator's free
   * tier behind it — so "who pays" is a property of the config that answered,
   * not of the request.
   */
  metered: boolean;
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
 * OpenRouter's free-variant models, ordered by how well they suit this app's
 * work: long transcripts in, short structured answers out.
 *
 * Every id here is copied from GET https://openrouter.ai/api/v1/models rather
 * than written from memory. That endpoint is public and needs no key, and it
 * is the only way to be sure — the earlier version of this list was guessed
 * from display names and five of its six entries were rejected outright
 * ("gemma-4-31b" is really "gemma-4-31b-it", "nemotron-3-super" is really
 * "nemotron-3-super-120b-a12b"). Because a bad id fails the same way an
 * exhausted rate limit does, the fallback chain hid it: every request quietly
 * walked the whole list to reach the one model that existed.
 *
 * Non-reasoning instruct models come first deliberately. The reasoning models
 * below them think before answering and bill that thinking to the same token
 * budget as the answer, which is what made chapter generation fail — see the
 * maxTokens note in generateChapters.
 *
 * The free catalogue rotates. Re-run the endpoint above when calls start
 * failing, or override the whole list with AI_OPENROUTER_MODELS in .env.local.
 */
const DEFAULT_OPENROUTER_FREE_MODELS = [
  // Answers with bare JSON and no preamble; the only candidate that spent zero
  // tokens on reasoning when probed.
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  // Reasoning models from here down. They work, but only with token headroom.
  "openai/gpt-oss-20b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
];

/** Reads a comma-separated model override, or null when it isn't set. */
function envModelChain(name: string): string[] | null {
  const override = process.env[name]
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return override && override.length > 0 ? override : null;
}

function openrouterModelChain(): string[] {
  return envModelChain("AI_OPENROUTER_MODELS") ?? DEFAULT_OPENROUTER_FREE_MODELS;
}

/**
 * Google's Gemini models, via the OpenAI-compatible surface of AI Studio.
 *
 * Google publishes both a native API and this shim, and the shim is the reason
 * Gemini needs no new client code: it speaks the same chat-completions wire
 * format and the same bearer auth as everything else here, so it drops into
 * the existing fetch untouched.
 *
 * Flash and flash-lite only — those are the tiers with a free allowance. Pro
 * models are deliberately absent rather than merely unlisted: they would work,
 * and they would bill.
 *
 * Every id below was confirmed to answer 200 on this endpoint. That is not
 * ceremony — "gemini-2.5-flash", the obvious guess and this list's first draft,
 * 404s here, as does "gemini-2.5-flash-lite". Google's OpenAI shim does not
 * expose the same model names as the native API, so the only reliable source
 * is a live GET against the /models path of this same baseUrl.
 *
 * The two `-latest` aliases sit behind the pinned ids on purpose. A pinned id
 * gives predictable behaviour until the day it is retired; the alias is the
 * insurance that the chain still resolves to something on that day, which is
 * exactly the failure this file has now been bitten by twice.
 */
const DEFAULT_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
];

function geminiModelChain(): string[] {
  return envModelChain("AI_GEMINI_MODELS") ?? DEFAULT_GEMINI_MODELS;
}

/**
 * NVIDIA NIM, via build.nvidia.com's hosted endpoints.
 *
 * Ids come from GET https://integrate.api.nvidia.com/v1/models, which needs no
 * key — so unlike the other two catalogues here, this list could be checked
 * before a key existed. What that check could not tell us is whether a listed
 * model actually answers, and two of these do not:
 *
 *   nvidia/llama-3.3-nemotron-super-49b-v1.5   first token in 1.5s
 *   meta/llama-3.1-70b-instruct                first token in 1.7s
 *   meta/llama-3.3-70b-instruct                no response headers in 10 min
 *   mistralai/mistral-medium-3.5-128b          no response headers in 10 min
 *
 * Measured against a real key on a real transcript. The two that hang do not
 * fail — no status, no error body, nothing to fall through on — they simply
 * never reply, and llama-3.3-70b sitting at the head of this list is the whole
 * reason adding a working NVIDIA key made the AI stop working: every request
 * opened on a model that would never answer.
 *
 * So the order here is measured rather than reasoned. The two that answer come
 * first; the two that hang stay at the back, where reaching them costs one
 * first-token timeout instead of the entire request, in case their silence is
 * particular to this account rather than to the models.
 */
const DEFAULT_NVIDIA_MODELS = [
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "meta/llama-3.1-70b-instruct",
  "meta/llama-3.3-70b-instruct",
  "mistralai/mistral-medium-3.5-128b",
];

function nvidiaModelChain(): string[] {
  return envModelChain("AI_NVIDIA_MODELS") ?? DEFAULT_NVIDIA_MODELS;
}

const LLM_ENDPOINTS: Record<LlmProvider, { baseUrl: string; defaultModel: string }> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: DEFAULT_GEMINI_MODELS[0],
  },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: DEFAULT_NVIDIA_MODELS[0],
  },
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

/** Which env var funds each provider's operator-funded tier. */
const LLM_KEY_ENV: Record<LlmProvider, string> = {
  gemini: "GEMINI_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/**
 * The order providers are tried in, not a choice between them.
 *
 * Every provider here is a peer. Each free tier has its own separate ceiling,
 * so one being exhausted says nothing about the next — which makes running out
 * on Gemini a reason to continue on NVIDIA, not a reason to fail. Ordering is
 * therefore about which is nicest to land on first, not about which is "the"
 * provider:
 *
 *  - gemini: largest free allowance, context window that swallows a three-hour
 *    transcript, and it answers directly instead of spending the token budget
 *    thinking.
 *  - nvidia: large instruct models on a free developer tier.
 *  - openrouter: several free models, but each on a small per-model limit, and
 *    the catalogue rotates underneath you.
 *  - deepseek / openai: paid. Last because reaching them costs real money, so
 *    they should only ever be a backstop for the free tiers above.
 *
 * Override with AI_PROVIDER_ORDER (comma-separated) to reorder or to leave a
 * provider out of the chain entirely while keeping its key in the environment.
 */
const LLM_PROVIDER_ORDER: LlmProvider[] = [
  "gemini",
  "nvidia",
  "openrouter",
  "deepseek",
  "openai",
];

function isLlmProvider(value: string): value is LlmProvider {
  return value in LLM_KEY_ENV;
}

/**
 * Resolves the order to try providers in.
 *
 * AI_DEFAULT_PROVIDER is still honoured, but only as "put this one first" —
 * it no longer excludes the others, because a provider that has hit its daily
 * limit needs somewhere to fall through to.
 */
function llmProviderOrder(): LlmProvider[] {
  const explicit = envModelChain("AI_PROVIDER_ORDER")
    ?.map((p) => p.toLowerCase())
    .filter(isLlmProvider);
  if (explicit && explicit.length > 0) return explicit;

  const first = process.env.AI_DEFAULT_PROVIDER?.toLowerCase();
  if (first && isLlmProvider(first)) {
    return [first, ...LLM_PROVIDER_ORDER.filter((p) => p !== first)];
  }
  return LLM_PROVIDER_ORDER;
}

function modelChainFor(provider: LlmProvider): string[] {
  if (provider === "gemini") return geminiModelChain();
  if (provider === "nvidia") return nvidiaModelChain();
  if (provider === "openrouter") return openrouterModelChain();
  return [process.env.AI_DEFAULT_MODEL || LLM_ENDPOINTS[provider].defaultModel];
}

function configFor(provider: LlmProvider, apiKey: string): LlmConfig {
  const models = modelChainFor(provider);
  return {
    provider,
    baseUrl: LLM_ENDPOINTS[provider].baseUrl,
    model: models[0],
    models,
    apiKey,
    metered: true,
  };
}

/**
 * Every configured provider, in the order they should be tried.
 *
 * Returns a chain rather than a winner. Previously this picked one provider and
 * a request that exhausted it simply failed, even with three other keys sitting
 * unused in the environment — the fallback logic existed, but only reached
 * between models of the single chosen provider.
 */
export function defaultLlmChain(): LlmConfig[] {
  const chain: LlmConfig[] = [];
  for (const provider of llmProviderOrder()) {
    const apiKey = process.env[LLM_KEY_ENV[provider]];
    if (apiKey) chain.push(configFor(provider, apiKey));
  }
  return chain;
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

/**
 * Providers where a personal key buys a free developer tier rather than a bill.
 *
 * The distinction matters because it decides whether trying a second model is
 * generous or expensive.
 */
const FREE_TIER_PROVIDERS: LlmProvider[] = ["gemini", "nvidia", "openrouter"];

/**
 * Builds an LLM config from a user's own key.
 *
 * A user's key is used *instead of* the operator's chain, never alongside it —
 * falling through to an operator-funded provider would bill the wrong person.
 * That makes this chain the only one the request has, and it used to be a
 * single model.
 *
 * Which is how adding a working NVIDIA key made the AI stop working. Before the
 * key there were nine candidates across two providers; after it there was one,
 * `meta/llama-3.3-70b-instruct`, with nothing behind it — so the first time that
 * one model was slow, the request had no second option and died on the timeout.
 *
 * So a free-tier key now gets the same chain the operator tier would use for it:
 * those catalogues are lists of separately-limited free models, and refusing to
 * try the second one buys nothing. Paid providers keep exactly the model the
 * user chose, because there the extra attempt is a charge they didn't ask for.
 */
export function byokLlmConfig(provider: LlmProvider, apiKey: string): LlmConfig {
  const endpoint = LLM_ENDPOINTS[provider];
  const models = FREE_TIER_PROVIDERS.includes(provider)
    ? modelChainFor(provider)
    : [endpoint.defaultModel];

  return {
    provider,
    baseUrl: endpoint.baseUrl,
    model: models[0],
    models,
    apiKey,
    metered: false,
  };
}

/** Builds a speech-to-text config from a user's own key. */
export function byokSttConfig(provider: HostedSttProvider, apiKey: string): SttConfig {
  const endpoint = STT_ENDPOINTS[provider];
  return { provider, baseUrl: endpoint.baseUrl, model: endpoint.defaultModel, apiKey };
}

/** True when the operator has configured enough for the free tier to work. */
export function isDefaultTierAvailable(): boolean {
  return defaultLlmChain().length > 0;
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
