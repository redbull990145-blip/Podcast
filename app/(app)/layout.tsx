import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { queueItems } from "@/lib/db/schema";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { TopBar } from "@/components/nav/top-bar";
import { MobileTabBar } from "@/components/nav/mobile-tab-bar";
import { PlayerProvider } from "@/components/player/player-provider";
import { PlayerBar } from "@/components/player/player-bar";
import { NowPlayingHost } from "@/components/player/now-playing-host";
import { PrefsHydrator } from "@/components/power-mode/power-mode-toggle";
import { KeyboardShortcuts } from "@/components/power-mode/keyboard-shortcuts";
import { CommandPaletteHost } from "@/components/command/command-palette-host";

/**
 * Authenticated shell.
 *
 * Middleware already redirects anonymous users away from these routes; this
 * second check is defence in depth, since middleware can be bypassed by
 * misconfiguration but a Server Component check cannot.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  // Server-rendered so the Up Next badge is right on first paint rather than
  // popping in a moment later; the bar keeps it current from the shared cache.
  const [queued] = await db
    .select({ value: count() })
    .from(queueItems)
    .where(eq(queueItems.userId, user.id));

  return (
    <ThemeProvider>
      <QueryProvider>
        <div className="min-h-dvh">
          <TopBar
            displayName={
              (user.user_metadata?.full_name as string | undefined) ??
              user.email?.split("@")[0] ??
              "You"
            }
            initialQueueCount={queued?.value ?? 0}
          />

          <MobileTabBar initialQueueCount={queued?.value ?? 0} />

          {/*
            Both bars overlay the page rather than displacing it, so the padding
            here is what keeps content clear of them.

            On a phone that is the tab bar at the top — 10px below the status
            bar, 62px tall, plus 18px of air — and the floating mini player at
            the bottom. The bottom figure is measured from the safe area rather
            than from the viewport edge: the player is inset from the home
            indicator, so anything that only cleared 120px of viewport would
            still end up underneath it on a device that has one.
          */}
          <main
            className={[
              "min-w-0",
              "pt-[calc(env(safe-area-inset-top)+5.625rem)]",
              "pb-[calc(env(safe-area-inset-bottom)+7.5rem)]",
              "lg:pb-28 lg:pt-[76px]",
            ].join(" ")}
          >
            {children}
          </main>

          <PlayerBar />
          <NowPlayingHost />
          {/* Code-split: nothing of it is fetched until ⌘K is first pressed. */}
          <CommandPaletteHost />
          {/* Headless: owns the audio element, position sync and OS controls. */}
          <PlayerProvider />
          {/* Headless: restores stored UI preferences, owns the shortcut layer. */}
          <PrefsHydrator />
          <KeyboardShortcuts />
        </div>
      </QueryProvider>
    </ThemeProvider>
  );
}
