import type { LlmProvider, SttProvider } from "./config";

/**
 * Checks a user-supplied key against its provider before storing it.
 *
 * Without this, a typo is only discovered later, in the middle of a
 * transcription, as a generic failure — and the person has no way to tell
 * whether their key is wrong or the app is broken. One cheap call at the moment
 * they paste it turns that into an immediate, specific answer.
 */

export type Provider = LlmProvider | SttProvider;

const VALIDATION_TIMEOUT_MS = 8_000;

/**
 * The cheapest authenticated endpoint each provider offers.
 *
 * Partial rather than exhaustive: "colab" is a dev-only transport preference
 * read from an env var, never a key a user pastes in here, so it has nothing
 * to validate against.
 */
const PROBES: Partial<Record<Provider, { url: string; headers: (key: string) => HeadersInit }>> = {
  gemini: {
    // AI Studio's OpenAI-compatible surface, so one bearer-token probe covers
    // it like the rest rather than needing Google's own ?key= convention.
    url: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/key",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  groq: {
    url: "https://api.groq.com/openai/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
  },
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string }
  /** Reached nobody — don't block saving on our own connectivity. */
  | { ok: "unknown" };

export async function validateApiKey(
  provider: Provider,
  apiKey: string,
): Promise<ValidationResult> {
  const probe = PROBES[provider];
  if (!probe) return { ok: "unknown" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetch(probe.url, {
      headers: probe.headers(apiKey),
      signal: controller.signal,
    });

    if (response.ok) return { ok: true };

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error:
          "That key was rejected by the provider. Check you copied all of it, and that it hasn't been revoked.",
      };
    }

    if (response.status === 429) {
      // The key authenticated; it is just busy. That is not a reason to refuse it.
      return { ok: true };
    }

    return { ok: "unknown" };
  } catch {
    // Timeout or network failure on our side. Saving an unverified key is far
    // better than refusing a valid one because the provider was briefly down.
    return { ok: "unknown" };
  } finally {
    clearTimeout(timeout);
  }
}
