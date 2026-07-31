/**
 * Input validation at the API boundary.
 *
 * Everything here guards against the same mistake: trusting a TypeScript type
 * assertion on a request body. `as { episodeId?: string }` is erased at
 * runtime, so it describes what a well-behaved client sends, not what actually
 * arrives. The values below are the ones that reach a database or a paid API,
 * where "whatever the client said" is not good enough.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Every id in this schema is a Postgres `uuid`, and Postgres rejects anything
 * else with a 22P02 rather than returning no rows. Without this check that
 * rejection surfaces as an unhandled 500 — the query is parameterized so
 * nothing is injectable, but a malformed id is a client mistake and should
 * read as one.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Longest prior turn worth replaying. Answers are short; this is generous. */
const MAX_TURN_CHARS = 4_000;

/** How many prior turns may be replayed, oldest dropped first. */
const MAX_TURNS = 6;

/**
 * Cleans conversation history arriving from a client.
 *
 * This is the one place a user can put arbitrary text directly into a prompt,
 * and it was previously passed through untouched. Two things follow from that.
 *
 * The role is re-derived rather than trusted. Sending `role: "system"` is just
 * a string in JSON, and it would land in the message array *after* the real
 * system prompt — letting anyone with an account replace this app's
 * instructions and use an operator-funded key as a general-purpose LLM.
 *
 * The length is capped because tokens cost money. The question itself is
 * limited to 1000 characters, which does nothing if six megabytes can ride
 * along beside it in the history.
 */
export function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];

  const turns: ChatTurn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { role, content } = entry as Record<string, unknown>;
    if (typeof content !== "string" || content.length === 0) continue;
    // Anything that is not literally "assistant" is treated as the user's own
    // words — the safer of the two, since it carries no authority.
    turns.push({
      role: role === "assistant" ? "assistant" : "user",
      content: content.slice(0, MAX_TURN_CHARS),
    });
  }

  return turns.slice(-MAX_TURNS);
}
