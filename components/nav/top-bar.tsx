"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { MotionLink } from "@/components/ui/motion-link";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SPRING } from "@/lib/motion/config";
import { pressSubtle } from "@/lib/motion/gestures";
import { NAV_ITEMS } from "./nav-items";
import { cn } from "@/lib/utils";

/**
 * Floating glass bar, the app's only chrome on desktop.
 *
 * It replaced a fixed sidebar, which is worth explaining because it costs a
 * persistent column of navigation. Almost every screen here is a grid of square
 * artwork, and square artwork is governed by width: taking 16rem off the left
 * dropped the library from five covers per row to four on a 1440 display, and
 * the covers are the content. Floating the nav over the page instead gives that
 * width back on every screen and costs one row of vertical space on one edge.
 *
 * It stays over the scrolling content rather than pushing it down so the page
 * reads as one continuous surface passing underneath — which is the only reason
 * to spend a backdrop-filter here at all.
 */
export function TopBar({
  displayName,
  initialQueueCount,
}: {
  displayName: string;
  initialQueueCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // ⌘K goes to the one search surface that exists rather than opening a
  // palette that would duplicate it. Discover's field autofocuses on mount, so
  // the keystroke lands the caret in a search box either way.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      router.push("/discover");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <header className="pointer-events-none fixed inset-x-3 top-3 z-40 lg:inset-x-7 lg:top-[18px]">
      <div className="glass-panel pointer-events-auto rounded-app-xl">
        <div className="flex items-center gap-2 py-[9px] pl-3 pr-2 lg:pl-[18px] lg:pr-3">
          <MotionLink
            {...pressSubtle}
            href="/home"
            aria-label="Cadence home"
            className="flex shrink-0 items-center gap-2 pr-2"
          >
            <Logo className="size-5 text-accent" />
            <span className="text-[15px] font-semibold -tracking-[0.02em] text-foreground">
              Cadence
            </span>
          </MotionLink>

          <span
            aria-hidden
            className="mx-1.5 hidden h-[22px] w-px shrink-0 bg-glass-ring lg:block"
          />

          {/* Below lg the sections live in the bottom tab bar instead. */}
          <nav aria-label="Sections" className="hidden items-center gap-0.5 lg:flex">
            {NAV_ITEMS.map((item) => (
              <NavPill
                key={item.href}
                {...item}
                active={
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                }
                badge={item.href === "/queue" ? initialQueueCount : undefined}
              />
            ))}
          </nav>

          <div className="min-w-6 flex-1" />

          <SearchField />

          <ThemeToggle className="hidden shrink-0 sm:inline-flex" />

          <ProfileButton
            displayName={displayName}
            active={pathname.startsWith("/settings")}
          />
        </div>
      </div>
    </header>
  );
}

function NavPill({
  href,
  label,
  Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-[38px] items-center gap-2 whitespace-nowrap rounded-app px-[15px]",
        "text-[13.5px] font-medium transition-colors",
        active ? "text-foreground" : "text-ink-2 hover:bg-glass-hover",
      )}
    >
      {/*
        One plate shared by every item via layoutId, so changing section slides
        the highlight from the old pill to the new one instead of blinking out
        here and in again there. Inert and behind the label so it never
        intercepts the click.

        Deliberately the only feedback these get — no press scale. Two reasons:
        the plate arriving *is* the answer to the click, so a scale would be a
        second answer to the same question; and scaling an ancestor of a
        `layoutId` element distorts the projection Motion measures the slide
        against, which makes the plate land a pixel or two off.
      */}
      {active && (
        <motion.span
          layoutId="top-nav-active"
          aria-hidden
          transition={SPRING.pop}
          className="absolute inset-0 -z-10 rounded-app bg-glass-pill shadow-[inset_0_1px_0_var(--glass-highlight),0_1px_2px_rgb(34_32_29_/_0.06)]"
        />
      )}
      <Icon className="size-[17px]" strokeWidth={1.75} />
      {label}
      {badge != null && badge > 0 && <QueueBadge fallback={badge} />}
    </Link>
  );
}

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
function QueueBadge({ fallback }: { fallback: number }) {
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
    <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent-subtle px-[5px] text-[10.5px] font-semibold tabular-nums text-accent">
      {count}
    </span>
  );
}

function SearchField() {
  return (
    <MotionLink
      {...pressSubtle}
      href="/discover"
      aria-label="Search podcasts"
      className={cn(
        "relative hidden h-[38px] w-[250px] shrink-0 items-center justify-between gap-2 md:flex",
        "rounded-app border border-border-strong bg-glass-pill pl-[34px] pr-2.5",
        "text-[13px] text-muted shadow-[inset_0_1px_0_var(--glass-highlight)]",
        "transition-colors hover:text-foreground",
      )}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 size-[15px] text-ink-3"
        strokeWidth={1.9}
      />
      <span className="truncate">Search everything</span>
      <kbd className="shrink-0 rounded-md border border-glass-ring bg-surface px-1.5 py-0.5 font-sans text-[11px] font-semibold tabular-nums text-ink-4">
        ⌘K
      </kbd>
    </MotionLink>
  );
}

function ProfileButton({
  displayName,
  active,
}: {
  displayName: string;
  active: boolean;
}) {
  return (
    <MotionLink
      {...pressSubtle}
      href="/settings"
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-[38px] shrink-0 items-center gap-2 rounded-full",
        "border border-border-strong bg-glass-pill p-[3px] pr-3",
        "shadow-[inset_0_1px_0_var(--glass-highlight)] transition-colors hover:bg-glass-hover",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -inset-px rounded-full border-[1.5px] border-accent"
        />
      )}
      <span
        aria-hidden
        className="grid size-[30px] place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground shadow-[0_1px_3px_rgb(34_32_29_/_0.2)]"
      >
        {displayName.slice(0, 1).toUpperCase()}
      </span>
      <span className="hidden max-w-28 truncate text-[13px] font-semibold sm:block">
        {displayName}
      </span>
      <span className="sr-only">Settings</span>
    </MotionLink>
  );
}
