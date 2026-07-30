"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { Wordmark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SPRING } from "@/lib/motion/config";
import { press } from "@/lib/motion/gestures";
import { NAV_ITEMS } from "./nav-items";
import { cn } from "@/lib/utils";

export function AppSidebar({
  email,
  displayName,
}: {
  email: string;
  displayName: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-surface/50 lg:flex">
      <div className="px-5 py-5">
        <Link href="/library">
          <Wordmark />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-[var(--radius-app)] px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "text-accent"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {/*
                One pill shared by every item via layoutId, so changing page
                slides the highlight from the old row to the new one instead of
                blinking out here and in again there. It is behind the label
                (-z-10) and inert, so it never intercepts the click.
              */}
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  aria-hidden
                  transition={SPRING.pop}
                  className="absolute inset-0 -z-10 rounded-[var(--radius-app)] bg-accent-subtle"
                />
              )}
              <Icon className="size-[18px]" strokeWidth={active ? 2.25 : 1.75} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-border p-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-subtle-foreground">Theme</span>
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-2 rounded-[var(--radius-app)] px-2 py-1.5">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-subtle text-xs font-semibold text-accent"
          >
            {displayName.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-xs text-subtle-foreground">{email}</p>
          </div>
          <form action={signOut}>
            <motion.button
              {...press}
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="grid size-8 place-items-center rounded-[var(--radius-app)] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <LogOut className="size-4" />
            </motion.button>
          </form>
        </div>
      </div>
    </aside>
  );
}
