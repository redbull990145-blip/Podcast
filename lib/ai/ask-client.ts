export type AskTurn = { role: "user" | "assistant"; content: string };

/**
 * Asks a question about an episode and reports the answer as it is written.
 *
 * The endpoint answers in one of two shapes and the difference is the status:
 * a failure — no quota, no transcript, no provider — is JSON, because nothing
 * has been generated yet, and a success is a plain text stream. That split is
 * only possible because the server commits to a model after its first word
 * rather than before, so by the time bytes are flowing there is nothing left
 * that can go wrong in a way the caller needs to branch on.
 *
 * `onDelta` is called with fragments, not whole sentences. Callers append.
 */
export async function askEpisode(
  request: { episodeId: string; question: string; history: AskTurn[] },
  onDelta: (delta: string) => void,
): Promise<{ ok: true } | { ok: false; error: string; needsTranscript?: boolean }> {
  let response: Response;
  try {
    response = await fetch("/api/ai/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      needsTranscript?: boolean;
    } | null;
    return {
      ok: false,
      error: body?.error ?? "Couldn't answer that.",
      needsTranscript: body?.needsTranscript,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Streaming decode: a multi-byte character can straddle two chunks, and
      // decoding each chunk in isolation would split it into replacement
      // characters mid-word.
      onDelta(decoder.decode(value, { stream: true }));
    }
  } catch {
    // A partial answer is already on screen and is worth more than replacing
    // it with an error, so the read simply stops.
  } finally {
    reader.releaseLock();
  }

  return { ok: true };
}
