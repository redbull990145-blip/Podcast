import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 3725 -> "1:02:05", 185 -> "3:05". Used for durations and playback position. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "--:--";
  }
  const seconds = Math.floor(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** "1h 2m" / "45m" — friendlier than a clock format for episode lists. */
export function formatDurationLong(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "";
  }
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Absolute date formatters.
 *
 * The locale is pinned rather than left to the runtime. `toLocaleDateString()`
 * with no locale uses the *environment's* locale, and the server's is not the
 * browser's — a Node process defaulting to en-GB renders "26 Jun" while the
 * browser renders "Jun 26", which React reports as a hydration mismatch and
 * then throws away and re-renders the whole subtree. Pinning makes both sides
 * agree; the app's copy is English throughout anyway.
 */
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
const SHORT_DATE_WITH_YEAR = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "3 days ago" style relative date, falling back to an absolute date past a month. */
export function formatRelativeDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";

  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  if (diffDays >= 7 && diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }

  return d.getFullYear() === new Date().getFullYear()
    ? SHORT_DATE.format(d)
    : SHORT_DATE_WITH_YEAR.format(d);
}

/**
 * Named entities worth spelling out.
 *
 * Publishers write show notes in a CMS that emits typographic punctuation as
 * entities, so curly quotes and dashes are not an edge case — they are what a
 * normal description is full of. Anything outside this list is far rarer than
 * the numeric escapes handled below.
 */
const HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  amp: "&",
};

/** Strip HTML from RSS descriptions, which routinely contain markup. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return (
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      /*
       * One pass over every entity rather than a chain of replaces.
       *
       * The chain had two faults. It knew six entities, so the curly quotes
       * that fill a typical description survived into the page as a literal
       * "&ldquo;". And it decoded &amp; before the rest, which meant a
       * correctly escaped "&amp;lt;" decoded twice and became "<" — text
       * turning back into markup, which is the direction that matters.
       *
       * Matching once fixes both: each entity is replaced exactly where it
       * was found, so nothing a replacement produces is read again.
       */
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
        if (body[0] === "#") {
          const codePoint =
            body[1] === "x" || body[1] === "X"
              ? Number.parseInt(body.slice(2), 16)
              : Number.parseInt(body.slice(1), 10);
          // Surrogates and out-of-range values would throw; leave them as text.
          if (!Number.isFinite(codePoint) || codePoint < 32 || codePoint > 0x10ffff) {
            return match;
          }
          if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
          return String.fromCodePoint(codePoint);
        }
        return HTML_ENTITIES[body.toLowerCase()] ?? match;
      })
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
