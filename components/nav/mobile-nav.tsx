"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { SPRING } from "@/lib/motion/config";
import { MOBILE_NAV_ITEMS } from "./nav-items";
import { cn } from "@/lib/utils";

/** Bottom tab bar. Sits below the player once that lands in Phase 1. */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <ul className="grid grid-cols-4">
        {MOBILE_NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-accent" : "text-muted-foreground",
                )}
              >
                {/* Slides between tabs rather than reappearing under each one. */}
                {active && (
                  <motion.span
                    layoutId="mobile-nav-active"
                    aria-hidden
                    transition={SPRING.pop}
                    className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent"
                  />
                )}

                {/*
                  The icon lifts a whisker when its tab becomes current. On a
                  phone-sized target it is the only element with room to carry a
                  state change without the label having to move.
                */}
                <motion.span
                  animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }}
                  transition={SPRING.pop}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                </motion.span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
