/**
 * Pure summarisers behind the dashboard.
 *
 * Kept free of the database so the arithmetic — which is where the judgement
 * calls live — can be tested directly. See lib/stats/listening.ts for the
 * queries that feed them.
 */

/** One row of listening progress, as the dashboard needs it. */
export type ListenedRow = {
  lastPlayedAt: Date;
  /** Where the user got to, in seconds. */
  positionSeconds: number;
  /** From the feed. Frequently absent — plenty of publishers omit it. */
  durationSeconds: number | null;
  played: boolean;
  categories: string[];
};

export type DayBucket = {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  /** Single-letter weekday, for the bar chart's axis. */
  label: string;
  seconds: number;
};

const DAY_MS = 86_400_000;

/*
 * Locale pinned for the same reason as the formatters in lib/utils.ts: the
 * server's locale is not the browser's, and an unpinned weekday name renders
 * differently on each side of a hydration boundary.
 */
const WEEKDAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});

/** YYYY-MM-DD in UTC. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * How much of an episode to credit when it was last touched.
 *
 * A finished episode is worth its whole duration; an unfinished one is worth
 * how far in the user got. Where the feed gives no duration, the position is
 * the only number available and has to stand in for both.
 *
 * This is an approximation and it is worth being precise about which way it is
 * wrong. There is no per-session log — `playback_state` holds one row per
 * episode with a single position and a single timestamp — so an episode picked
 * up across three evenings credits all of its progress to the last of them.
 * Totals over a week are right; the distribution across days within that week
 * is smeared toward the most recent listen.
 */
function creditedSeconds(row: ListenedRow): number {
  const credited = row.played ? (row.durationSeconds ?? row.positionSeconds) : row.positionSeconds;
  return Number.isFinite(credited) && credited > 0 ? credited : 0;
}

/**
 * The last `days` calendar days ending today, oldest first.
 *
 * Always returns a full set of buckets, including empty ones — a chart that
 * silently drops quiet days would compress the week and misreport the shape of
 * someone's listening as denser than it was.
 */
export function dailyBreakdown(
  rows: ListenedRow[],
  now: Date = new Date(),
  days = 7,
): DayBucket[] {
  const buckets = new Map<string, DayBucket>();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * DAY_MS);
    const key = dayKey(date);
    buckets.set(key, { date: key, label: WEEKDAY.format(date).slice(0, 1), seconds: 0 });
  }

  for (const row of rows) {
    const bucket = buckets.get(dayKey(row.lastPlayedAt));
    if (bucket) bucket.seconds += creditedSeconds(row);
  }

  return [...buckets.values()];
}

/** Total credited listening across rows falling inside the window. */
export function totalSeconds(rows: ListenedRow[], now: Date = new Date(), days = 7): number {
  const cutoff = now.getTime() - days * DAY_MS;
  return rows.reduce(
    (sum, row) => (row.lastPlayedAt.getTime() >= cutoff ? sum + creditedSeconds(row) : sum),
    0,
  );
}

/** Episodes finished inside a window that starts `from` days ago and ends `to` days ago. */
export function completedBetween(
  rows: ListenedRow[],
  now: Date = new Date(),
  from = 7,
  to = 0,
): number {
  const start = now.getTime() - from * DAY_MS;
  const end = now.getTime() - to * DAY_MS;
  return rows.filter(
    (r) => r.played && r.lastPlayedAt.getTime() >= start && r.lastPlayedAt.getTime() < end,
  ).length;
}

/**
 * Category mix, weighted by time rather than by episode count.
 *
 * Counting episodes would let a show that publishes ten-minute dispatches
 * outrank one the user spends four hours a week inside, which is the opposite
 * of what "most time in" means.
 *
 * A show carries several categories in its feed and every one of them gets the
 * full weight rather than a share of it. Splitting the credit would make a
 * thoroughly tagged show count for less than a lazily tagged one, and these are
 * shares of attention, not a partition of it — which is also why the returned
 * shares are each relative to the leader rather than summing to 1.
 */
export function topCategories(
  rows: ListenedRow[],
  now: Date = new Date(),
  days = 7,
  limit = 3,
): { name: string; seconds: number; share: number }[] {
  const cutoff = now.getTime() - days * DAY_MS;
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (row.lastPlayedAt.getTime() < cutoff) continue;
    const seconds = creditedSeconds(row);
    if (seconds === 0) continue;
    for (const category of row.categories) {
      const name = category.trim();
      if (name) totals.set(name, (totals.get(name) ?? 0) + seconds);
    }
  }

  const ranked = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);

  const leader = ranked[0]?.[1] ?? 0;

  return ranked.map(([name, seconds]) => ({
    name,
    seconds,
    share: leader > 0 ? seconds / leader : 0,
  }));
}

/**
 * Consecutive days ending today on which the user listened to something.
 *
 * Today not yet having a listen does not break the streak — it has not happened
 * *yet*. Counting from today would reset the number to zero every midnight and
 * show a 0 for most of the morning, which is both wrong and discouraging. So an
 * unlistened today is skipped and the count starts at yesterday; a gap anywhere
 * before that ends it.
 */
export function computeStreak(listenedDays: Iterable<Date>, now: Date = new Date()): number {
  const days = new Set([...listenedDays].map(dayKey));
  if (days.size === 0) return 0;

  let streak = 0;
  let cursor = now.getTime();

  if (!days.has(dayKey(new Date(cursor)))) cursor -= DAY_MS;

  while (days.has(dayKey(new Date(cursor)))) {
    streak++;
    cursor -= DAY_MS;
  }

  return streak;
}

/** 45_240 -> "12.6". One decimal is the resolution the number deserves. */
export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

/** 1_288_490_188 -> "1.2 GB". Decimal units, the way storage is sold and shown. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
