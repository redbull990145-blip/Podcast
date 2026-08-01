"use client";

import { useEffect, useState } from "react";

/*
 * Locale and weekday pinned the same way as the formatters in lib/utils.ts.
 */
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });

function label(now: Date): string {
  const hour = now.getHours();
  const part =
    hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `${WEEKDAY.format(now)} ${part}`;
}

/**
 * "Thursday evening" — the only line on the dashboard that depends on the
 * reader's clock rather than on their data.
 *
 * Rendered after mount, not on the server. The server's timezone is not the
 * reader's, so a server-rendered "Thursday evening" is wrong for anyone far
 * enough east or west, and pre-rendering the wrong value then correcting it is
 * worse than briefly showing nothing: React keeps the server's text through
 * hydration, so the wrong one would be the one that stays.
 *
 * The line holds its height while empty so the heading beneath it does not jump.
 */
export function Greeting() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  return (
    <p className="min-h-[1.2em] text-xs font-semibold uppercase tracking-[0.12em] text-subtle-2">
      {now ? label(now) : ""}
    </p>
  );
}
