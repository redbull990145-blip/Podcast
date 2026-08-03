"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import type { MotionStyle } from "motion/react";
import { Search } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { MotionLink } from "@/components/ui/motion-link";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SPRING } from "@/lib/motion/config";
import { pressSubtle } from "@/lib/motion/gestures";
import { usePrefs } from "@/lib/prefs/store";
import { NAV_ITEMS } from "./nav-items";
import { QueueBadge } from "./queue-badge";
import { useBarLift } from "./use-bar-lift";
import { cn } from "@/lib/utils";

/**
 * Floating glass bar, the app's only chrome on desktop — and only on desktop.
 *
 * Below `lg` the phone's own chrome takes over entirely: `MobileTabBar` is the
 * same material carrying the sections, and Settings, search and the theme
 * control are reached from inside the app rather than from a strip that would
 * have room for one of the three. Hidden rather than adapted, because there is
 * nothing in here a 402px-wide bar can keep.
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
 *
 * At the very top of a page there is nothing behind it, and a bar casting a
 * shadow onto empty background reads as a seam across the screen. So its lift
 * is tied to scroll: flat while it is sitting on the page, and detached once
 * content has actually travelled under it. See `useBarLift`.
 *
 * The material itself is `.fluid-glass` in globals.css — a squircle slab whose
 * parameters come from React Bits' FluidGlass. Everything static about it lives
 * in the stylesheet; the one part that cannot is the sheen, which tracks the
 * pointer from here. See `useGlassSheen`.
 */
export function TopBar({
  displayName,
  initialQueueCount,
}: {
  displayName: string;
  initialQueueCount: number;
}) {
  const pathname = usePathname();
  const setPaletteOpen = usePrefs((s) => s.setPaletteOpen);

  /*
   * ⌘K opens the command palette.
   *
   * It used to push /discover, on the reasoning that the palette would only
   * duplicate the one search surface that existed. That held while search was
   * the only thing worth reaching by keyboard; it stopped holding once there
   * were commands to run, and a shortcut that navigates instead of opening
   * something is the wrong shape for a palette regardless — it loses the page
   * you were on, which is exactly what a palette is supposed to preserve.
   *
   * The listener stays here rather than moving into the palette so the palette
   * itself renders nothing until it is opened.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  const lift = useBarLift();
  const sheen = useGlassSheen();

  return (
    <header className="pointer-events-none fixed inset-x-7 top-[18px] z-40 hidden lg:block">
      <motion.div
        /* Motion writes custom properties fine; `MotionStyle` just has no index
           signature for them, so the key has to be asserted in. */
        style={{ "--fg-sweep": sheen.sweep } as MotionStyle}
        onPointerMove={sheen.onPointerMove}
        onPointerLeave={sheen.onPointerLeave}
        className="fluid-glass pointer-events-auto"
      >
        {/*
          Sits behind the panel's own background, so its shadow spills outward
          and nothing of the layer itself is ever visible.
        */}
        <motion.span
          aria-hidden
          style={{ opacity: lift }}
          className="fluid-glass-lift pointer-events-none absolute inset-0 -z-10"
        />
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
      </motion.div>
    </header>
  );
}

/**
 * The one moving part of the glass: where its highlight is lit from.
 *
 * FluidGlass's lens follows the cursor, and that is not decoration — a static
 * highlight is the single thing that gives away a painted gradient, because
 * real specular reflection is a function of where you are relative to the
 * light. A pane whose shine never answers the pointer is a picture of glass.
 * What moves here is only the light: the slab is fixed, as a bar has to be.
 *
 * Writes a motion value into a custom property rather than into React state,
 * for the same reason `useBarLift` does — pointermove fires faster than a
 * frame, and re-rendering five nav pills, the queue badge's external-store
 * subscription, the search field and the profile button on each one, to move a
 * gradient, is not a trade worth making. Motion writes `--fg-sweep` straight to
 * the node and React never hears about the pointer at all.
 *
 * The spring is much looser than anything in SPRING, and deliberately so:
 * those are all tuned to *arrive*, and this one is tuned to trail. Light
 * pooling in a thick material lags the thing moving it, and a highlight locked
 * exactly to the cursor reads as a hard object stuck to the pointer instead. It
 * stays underdamped enough to keep travelling for a beat after the pointer
 * stops, which is the whole "fluid" of it.
 */
function useGlassSheen() {
  const reduceMotion = useReducedMotion() ?? false;

  const target = useMotionValue(50);
  const eased = useSpring(target, { stiffness: 90, damping: 20, mass: 0.8 });
  const sweep = useMotionTemplate`${eased}%`;

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      /*
       * Mouse only. A touch drag across the bar is a scroll gesture or a tap on
       * its way somewhere, and lighting the glass from wherever a finger last
       * landed is a response to something the user did not mean as input.
       */
      if (reduceMotion || e.pointerType !== "mouse") return;
      const box = e.currentTarget.getBoundingClientRect();
      target.set(((e.clientX - box.left) / box.width) * 100);
    },
    [reduceMotion, target],
  );

  /* Back to centre, so the bar's resting state is the same however you left it. */
  const onPointerLeave = useCallback(() => target.set(50), [target]);

  return { sweep, onPointerMove, onPointerLeave };
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
 * Opens the palette rather than navigating.
 *
 * It looks like an input and is a button, which is deliberate: it is the
 * discoverable form of ⌘K, and clicking it lands in the same place the shortcut
 * does. Making it a real input would mean maintaining a second search
 * implementation in the chrome, and typing into it would have to hand the
 * keystrokes to the palette anyway.
 */
function SearchField() {
  const setPaletteOpen = usePrefs((s) => s.setPaletteOpen);

  return (
    <motion.button
      {...pressSubtle}
      type="button"
      onClick={() => setPaletteOpen(true)}
      aria-label="Search and commands"
      aria-keyshortcuts="Meta+K Control+K"
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
    </motion.button>
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
