"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { SPRING } from "@/lib/motion/config";
import { MOBILE_TAB_ITEMS } from "./nav-items";
import { QueueBadge } from "./queue-badge";
import { useBarLift } from "./use-bar-lift";
import { cn } from "@/lib/utils";

/**
 * The phone's entire chrome: five destinations in a floating glass bar.
 *
 * It sits at the *top*, which is the one decision here worth defending, because
 * every convention says a phone's tabs belong under the thumb. Two things
 * moved it. The player is the control anyone reaches for one-handed and it now
 * floats above the home indicator — putting tabs there too meant two stacked
 * bars eating 130px of a 874px screen, and the tabs were the half nobody was
 * reaching for mid-episode. And this bar replaces the desktop top bar as well
 * as the old bottom one: on a phone there is no logo, no search field and no
 * profile button anywhere else, so the chrome is this and the mini player and
 * nothing else.
 *
 * It floats over the page rather than displacing it, for the same reason the
 * desktop bar does — the content passing underneath is what makes the material
 * read as glass rather than as a painted strip, and it is the only thing that
 * justifies spending a backdrop-filter here.
 *
 * The material itself is `.fluid-glass` in globals.css, shared with the desktop
 * bar. What is deliberately *not* shared is the pointer-tracked sheen: it is
 * mouse-only by design, and there is no mouse here, so this bar simply gets the
 * material's resting light.
 */
export function MobileTabBar({
  initialQueueCount,
}: {
  initialQueueCount: number;
}) {
  const pathname = usePathname();
  const lift = useBarLift();

  return (
    <header
      /*
       * 10px in from each edge and 10px below the status bar, matching the mini
       * player's inset at the other end of the screen so the two read as one
       * pair of floating slabs rather than as two unrelated bars.
       */
      className="pointer-events-none fixed inset-x-2.5 top-[calc(env(safe-area-inset-top)+0.625rem)] z-40 lg:hidden"
    >
      <nav aria-label="Sections" className="fluid-glass pointer-events-auto">
        {/* Behind the panel's own background, so only the shadow spilling past
            the edge is ever visible. See `.fluid-glass-lift`. */}
        <motion.span
          aria-hidden
          style={{ opacity: lift }}
          className="fluid-glass-lift pointer-events-none absolute inset-0 -z-10"
        />

        <ul className="grid grid-cols-5 gap-0.5 p-[5px]">
          {MOBILE_TAB_ITEMS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href} className="min-w-0">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-13 flex-col items-center justify-center gap-[3px] rounded-[14px]",
                    "text-[10px] font-semibold leading-none transition-colors",
                    active ? "text-foreground" : "text-ink-3",
                  )}
                >
                  {/*
                    One plate shared by all five via layoutId, so changing
                    section slides the highlight across rather than blinking out
                    here and in again there. Inert and behind the label so it
                    never intercepts the tap.
                  */}
                  {active && (
                    <motion.span
                      layoutId="mobile-tab-active"
                      aria-hidden
                      transition={SPRING.pop}
                      className="absolute inset-0 -z-10 rounded-[14px] bg-glass-pill shadow-[inset_0_1px_0_var(--glass-highlight),0_1px_2px_rgb(34_32_29_/_0.07)]"
                    />
                  )}

                  <span className="relative grid place-items-center">
                    <Icon className="size-5" strokeWidth={active ? 2 : 1.8} />
                    {href === "/queue" && (
                      /*
                        Over the icon rather than beside the label, which is the
                        only place it fits: the labels are 10px and already at
                        the width of their column, so a badge on the same line
                        would push one of them to two lines.
                      */
                      <QueueBadge
                        fallback={initialQueueCount}
                        className="absolute -right-2.5 -top-1.5 h-4 min-w-4 border border-[var(--surface)] text-[9.5px]"
                      />
                    )}
                  </span>

                  <span className="max-w-full truncate">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
