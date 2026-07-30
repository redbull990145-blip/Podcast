import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { servedLocally, transcribeWithFallback } from "./transcribe";
import { colabSttConfig, type SttConfig } from "./config";

/**
 * transcribeWithFallback is the one piece of the Colab integration with real
 * branching logic — everything else in lib/ai/config.ts is env-var plumbing
 * consistent with the rest of that file, which isn't unit-tested either.
 *
 * These tests fake the network entirely: a fixed small "episode" download, a
 * controllable /health response, and a controllable transcription response,
 * so each scenario is one or two lines of setup rather than a real server.
 */

const AUDIO_URL = "https://cdn.example/episode.mp3";
const FALLBACK: SttConfig = {
  provider: "groq",
  baseUrl: "https://api.groq.example",
  model: "whisper-large-v3-turbo",
  apiKey: "groq-key",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function audioResponse() {
  const bytes = new Uint8Array(20).fill(1);
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": "audio/mpeg", "content-length": "20" },
  });
}

const TRANSCRIPTION_BODY = {
  text: "hello world",
  segments: [{ start: 0, end: 1, text: "hello world" }],
  words: [],
};

describe("transcribeWithFallback", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("goes straight to the fallback provider when Colab isn't configured", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "");

    fetchMock.mockImplementation((url: string) => {
      if (url === AUDIO_URL) return Promise.resolve(audioResponse());
      if (url.includes("groq.example")) return Promise.resolve(jsonResponse(TRANSCRIPTION_BODY));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);

    expect(result.ok).toBe(true);
    expect(result.ok && result.model).toBe("groq/whisper-large-v3-turbo");
    // No /health call at all — nobody who hasn't set the env var pays for it.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/health"))).toBe(false);
  });

  it("falls back when the Colab server doesn't answer its health check", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/health")) return Promise.resolve(new Response(null, { status: 503 }));
      if (url === AUDIO_URL) return Promise.resolve(audioResponse());
      if (url.includes("groq.example")) return Promise.resolve(jsonResponse(TRANSCRIPTION_BODY));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);

    expect(result.ok).toBe(true);
    expect(result.ok && result.model).toBe("groq/whisper-large-v3-turbo");
    // The episode is fetched twice (a size probe, then the real download) for
    // the one transcribeAudio call that actually happens — the fallback's.
    // Colab is never touched beyond its failed health check.
    const audioFetches = fetchMock.mock.calls.filter(([url]) => url === AUDIO_URL);
    expect(audioFetches).toHaveLength(2);
  });

  it("falls back when the health check times out (notebook not running)", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    fetchMock.mockImplementation((url: string, init?: { signal?: AbortSignal }) => {
      if (url.includes("/health")) {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
        });
      }
      if (url === AUDIO_URL) return Promise.resolve(audioResponse());
      if (url.includes("groq.example")) return Promise.resolve(jsonResponse(TRANSCRIPTION_BODY));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);
    expect(result.ok).toBe(true);
    expect(result.ok && result.model).toBe("groq/whisper-large-v3-turbo");
  }, 10_000);

  it("uses Colab's result when it answers", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url === AUDIO_URL) return Promise.resolve(audioResponse());
      if (url.includes("colab.example")) return Promise.resolve(jsonResponse(TRANSCRIPTION_BODY));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);

    expect(result.ok).toBe(true);
    expect(result.ok && result.model).toBe("colab/whisper");
    // Fallback was never touched.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("groq.example"))).toBe(
      false,
    );
  });

  it("falls back when Colab answers the health check but fails to transcribe", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url === AUDIO_URL) return Promise.resolve(audioResponse());
      if (url.includes("colab.example")) {
        return Promise.resolve(
          jsonResponse({ error: { message: "CUDA out of memory" } }, { status: 500 }),
        );
      }
      if (url.includes("groq.example")) return Promise.resolve(jsonResponse(TRANSCRIPTION_BODY));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);

    expect(result.ok).toBe(true);
    expect(result.ok && result.model).toBe("groq/whisper-large-v3-turbo");
    // Each transcribeAudio call probes then downloads the episode (2 fetches),
    // and this scenario runs two full attempts — Colab, then the retry — since
    // a failure isn't known until after the upload. That's the cost of falling
    // back at this level rather than caching the download across providers.
    const audioFetches = fetchMock.mock.calls.filter(([url]) => url === AUDIO_URL);
    expect(audioFetches).toHaveLength(4);
  });

  // A null fallback is how the caller says "this is allowed to run precisely
  // because it costs nothing" — someone past their daily allowance. Silently
  // reaching for a paid provider there would defeat the whole point.
  describe("local-only (null fallback)", () => {
    it("uses the local server and never touches a paid provider", async () => {
      vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
        if (url === AUDIO_URL) return Promise.resolve(audioResponse());
        if (url.includes("colab.example")) return Promise.resolve(jsonResponse(TRANSCRIPTION_BODY));
        throw new Error(`unexpected fetch: ${url}`);
      });

      const result = await transcribeWithFallback(AUDIO_URL, null);

      expect(result.ok).toBe(true);
      expect(servedLocally(result)).toBe(true);
    });

    it("fails with actionable advice rather than paying, when the server is down", async () => {
      vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/health")) return Promise.resolve(new Response(null, { status: 502 }));
        throw new Error(`unexpected fetch: ${url}`);
      });

      const result = await transcribeWithFallback(AUDIO_URL, null);

      expect(result.ok).toBe(false);
      // The tunnel URL changing on every restart is the likeliest cause, so
      // the message says so instead of just "failed".
      expect(!result.ok && result.error).toContain("COLAB_WHISPER_URL");
    });

    it("does not retry against a paid provider when the local run fails", async () => {
      vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

      fetchMock.mockImplementation((url: string) => {
        if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
        if (url === AUDIO_URL) return Promise.resolve(audioResponse());
        if (url.includes("colab.example")) {
          return Promise.resolve(jsonResponse({ error: "boom" }, { status: 500 }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const result = await transcribeWithFallback(AUDIO_URL, null);

      expect(result.ok).toBe(false);
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("groq.example"))).toBe(
        false,
      );
    });

    it("reports plainly when there is no provider at all", async () => {
      vi.stubEnv("COLAB_WHISPER_URL", "");

      const result = await transcribeWithFallback(AUDIO_URL, null);

      expect(result.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // A Cloudflare quick tunnel returns 524 for anything the origin hasn't
  // answered in ~100s, and neither end can raise that. So the local config is
  // shaped around time-per-request, not bytes-per-request like a hosted API.
  it("shapes local requests around the tunnel's request timeout", () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");
    const local = colabSttConfig();

    // Small enough that even thrifty low-bitrate audio transcribes inside
    // the tunnel's window.
    expect(local?.chunkTargetBytes).toBeLessThanOrEqual(6 * 1024 * 1024);
    expect(local?.chunkTargetBytes).toBeLessThan(local!.maxUploadBytes!);

    // Sequential: the notebook serialises GPU work anyway, and a queued
    // request would spend its tunnel budget waiting instead of working.
    expect(local?.concurrency).toBe(1);

    // ...but the job as a whole gets long enough for an episode's worth of
    // those chunks, run one after another.
    expect(local?.jobDeadlineMs).toBeGreaterThan(10 * 60_000);
  });

  describe("servedLocally", () => {
    it("distinguishes a locally-produced transcript from a paid one", () => {
      const base = { ok: true as const, text: "x", segments: [] };
      expect(servedLocally({ ...base, model: "colab/whisper" })).toBe(true);
      expect(servedLocally({ ...base, model: "groq/whisper-large-v3-turbo" })).toBe(false);
      expect(servedLocally({ ok: false, error: "nope" })).toBe(false);
    });
  });

  it("sends the shared secret on the health check when one is configured", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");
    vi.stubEnv("COLAB_SHARED_SECRET", "super-secret");

    let sawAuth: string | null = null;
    fetchMock.mockImplementation((url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes("/health")) {
        sawAuth = init?.headers?.authorization ?? null;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url === AUDIO_URL) return Promise.resolve(audioResponse());
      if (url.includes("colab.example")) return Promise.resolve(jsonResponse(TRANSCRIPTION_BODY));
      throw new Error(`unexpected fetch: ${url}`);
    });

    await transcribeWithFallback(AUDIO_URL, FALLBACK);
    expect(sawAuth).toBe("Bearer super-secret");
  });
});
