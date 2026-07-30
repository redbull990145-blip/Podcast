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

/**
 * A local server that accepts a job and reports `final` on every poll.
 *
 * The local path never uploads audio, so this deliberately has no handler for
 * AUDIO_URL — a test that somehow reaches for the bytes will throw rather than
 * quietly pass.
 */
function colabJobs(final: Record<string, unknown>) {
  return (url: string) => {
    if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
    if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse({ job_id: "j1" }));
    if (url.includes("/jobs/")) return Promise.resolve(jsonResponse(final));
    throw new Error(`unexpected fetch: ${url}`);
  };
}

describe("transcribeWithFallback", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Real polling waits seconds between attempts; tests shouldn't.
    vi.stubEnv("COLAB_POLL_INTERVAL_MS", "5");
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

  it("uses the local server's result when it answers", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    fetchMock.mockImplementation(colabJobs({ status: "done", ...TRANSCRIPTION_BODY }));

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);

    expect(result.ok).toBe(true);
    expect(result.ok && result.model).toBe("colab/whisper");
    // The audio itself was never moved through this process — only its URL.
    expect(fetchMock.mock.calls.some(([url]) => url === AUDIO_URL)).toBe(false);
    // Fallback was never touched.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("groq.example"))).toBe(
      false,
    );
  });

  it("hands the local server a URL rather than uploading the episode", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    let posted: unknown = null;
    fetchMock.mockImplementation((url: string, init?: { body?: string }) => {
      if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url.endsWith("/jobs")) {
        posted = JSON.parse(init?.body ?? "{}");
        return Promise.resolve(jsonResponse({ job_id: "j1" }));
      }
      if (url.includes("/jobs/")) {
        return Promise.resolve(jsonResponse({ status: "done", ...TRANSCRIPTION_BODY }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await transcribeWithFallback(AUDIO_URL, FALLBACK);
    expect(posted).toEqual({ url: AUDIO_URL });
  });

  it("waits through queued and running states before reading the result", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    const states = [
      { status: "queued" },
      { status: "downloading" },
      { status: "transcribing" },
      { status: "done", ...TRANSCRIPTION_BODY },
    ];
    let poll = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse({ job_id: "j1" }));
      if (url.includes("/jobs/")) {
        return Promise.resolve(jsonResponse(states[Math.min(poll++, states.length - 1)]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);
    expect(result.ok).toBe(true);
    expect(poll).toBeGreaterThanOrEqual(4);
  });

  it("survives a dropped poll rather than abandoning a running job", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    let poll = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse({ job_id: "j1" }));
      if (url.includes("/jobs/")) {
        poll += 1;
        // Tunnels hiccup; one bad poll must not kill a healthy job.
        if (poll <= 2) return Promise.reject(new Error("socket hang up"));
        return Promise.resolve(jsonResponse({ status: "done", ...TRANSCRIPTION_BODY }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);
    expect(result.ok).toBe(true);
  });

  it("falls back when the local job reports an error", async () => {
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/health")) return Promise.resolve(jsonResponse({ ok: true }));
      if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse({ job_id: "j1" }));
      if (url.includes("/jobs/")) {
        return Promise.resolve(
          jsonResponse({ status: "error", error: "RuntimeError: CUDA out of memory" }),
        );
      }
      if (url === AUDIO_URL) return Promise.resolve(audioResponse());
      if (url.includes("groq.example")) return Promise.resolve(jsonResponse(TRANSCRIPTION_BODY));
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await transcribeWithFallback(AUDIO_URL, FALLBACK);

    expect(result.ok).toBe(true);
    expect(result.ok && result.model).toBe("groq/whisper-large-v3-turbo");
  });

  // A null fallback is how the caller says "this is allowed to run precisely
  // because it costs nothing" — someone past their daily allowance. Silently
  // reaching for a paid provider there would defeat the whole point.
  describe("local-only (null fallback)", () => {
    it("uses the local server and never touches a paid provider", async () => {
      vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");
      fetchMock.mockImplementation(colabJobs({ status: "done", ...TRANSCRIPTION_BODY }));

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

    it("does not retry against a paid provider when the local job fails", async () => {
      vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");
      fetchMock.mockImplementation(colabJobs({ status: "error", error: "boom" }));

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

  it("polls the local server rather than holding one long request open", () => {
    // Every request to a local server must be short: the tunnel in front of it
    // abandons anything unanswered for ~100s, which is far less than a long
    // episode takes. Hence a job id and polling, not one blocking upload.
    vi.stubEnv("COLAB_WHISPER_URL", "http://colab.example");
    const local = colabSttConfig();

    expect(local?.requestTimeoutMs).toBeLessThan(100_000);
    expect(local?.pollIntervalMs).toBeGreaterThan(0);
    // ...while the job as a whole gets as long as a real episode needs.
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
