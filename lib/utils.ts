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

/** Strip HTML from RSS descriptions, which routinely contain markup. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
