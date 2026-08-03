/**
 * Breaking an answer into the pieces that render differently.
 *
 * Two kinds of thing in an answer are not plain text: a citation, which becomes
 * a button that seeks the player, and a run of markdown emphasis, which the
 * models reach for unprompted — bold for the label on a bullet, italics around
 * a show's name — and which reads as literal asterisks if nothing handles it.
 *
 * Emphasis requires its asterisks to hug the words they mark, so arithmetic in
 * an answer ("2 * 3") is not mistaken for it. Bold is matched before italics,
 * or the opening `**` would be read as an empty italic run.
 *
 * Both are found in one pass. Scanning for one and then the other would mean
 * re-scanning text that had already become elements, and the second pass could
 * only see the parts the first left behind.
 */

export type AnswerToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  /** `text` is the label to show; `at` is where it seeks to, in seconds. */
  | { kind: "cite"; text: string; at: number };

/**
 * Three digits of minutes are accepted even though the transcript no longer
 * offers them: answers written before timestamps rolled into hours are cached
 * in the summaries table and still say "[171:09]", meaning 171 minutes in.
 *
 * Read literally, always. A model that mangles "2:51:09" into "251:09" produces
 * something indistinguishable from an honest 251-minute mark, and guessing
 * between them needs the episode's duration, which this layer does not have.
 * The literal reading is at least the one the format actually specifies.
 */
const TOKEN =
  /\*\*(.+?)\*\*|\*(?!\s)([^*\n]+?)(?<!\s)\*|\[(\d{1,3}:\d{2}(?::\d{2})?)\]/g;

export function toSeconds(stamp: string): number {
  const parts = stamp.split(":").map(Number);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

/**
 * A position in the episode, normalized from the seek target rather than echoed
 * from what the model wrote.
 *
 * Models are inconsistent about carrying hours — one answer about a three-hour
 * episode cited "[1:21:03]" and "[111:12]" in the same breath — and a reader
 * should not have to work out that the second one is a time at all.
 */
export function formatStamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function tokenizeAnswer(text: string): AnswerToken[] {
  const tokens: AnswerToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index!;
    if (index > lastIndex) {
      tokens.push({ kind: "text", text: text.slice(lastIndex, index) });
    }

    if (match[1] !== undefined) {
      tokens.push({ kind: "bold", text: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ kind: "italic", text: match[2] });
    } else {
      const at = toSeconds(match[3]);
      tokens.push({ kind: "cite", text: formatStamp(at), at });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return tokens;
}
