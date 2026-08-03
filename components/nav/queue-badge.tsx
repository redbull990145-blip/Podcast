"use client";

import { useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

/**
 * Count of episodes waiting in Up Next.
 *
 * The number arrives server-rendered so the badge is correct on first paint,
 * and this subscribes to the shared queue cache for anything newer — so it
 * never issues a request of its own, it just re-renders when the queue page or
 * a queue mutation writes to that key. Polling from the top bar would put a
 * request on every page load in the app for a two-digit number.
 *
 * Reading the cache directly rather than through `useQuery({ enabled: false })`:
 * that form still *registers* a query, and registering one with no `queryFn`
 * makes React Query log an error on every mount. There is no query here to
 * register — only a cache to watch.
 */
export function QueueBadge({
  fallback,
  className,
}: {
  fallback: number;
  className?: string;
}) {
  const client = useQueryClient();

  const data = useSyncExternalStore(
    (onChange) => client.getQueryCache().subscribe(onChange),
    () => client.getQueryData<{ queue: unknown[] }>(["queue"]),
    // Nothing is cached during SSR, so the server always renders `fallback`.
    () => undefined,
  );

  const count = data?.queue.length ?? fallback;
  if (count === 0) return null;

  return (
    <span
      className={cn(
        "grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent-subtle px-[5px] text-[10.5px] font-semibold tabular-nums text-accent",
        className,
      )}
    >
      {count}
    </span>
  );
}
