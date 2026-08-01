import { redirect } from "next/navigation";
import { count, eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { queueItems } from "@/lib/db/schema";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { TopBar } from "@/components/nav/top-bar";
import { MobileNav } from "@/components/nav/mobile-nav";
import { PlayerProvider } from "@/components/player/player-provider";
import { PlayerBar } from "@/components/player/player-bar";
import { NowPlayingHost } from "@/components/player/now-playing-host";
import { PrefsHydrator } from "@/components/power-mode/power-mode-toggle";
import { KeyboardShortcuts } from "@/components/power-mode/keyboard-shortcuts";

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

          {/*
            Top padding clears the floating bar, which overlays the page rather
            than displacing it. Bottom padding clears the mobile tab bar and the
            docked player.
          */}
          <main className="min-w-0 pb-40 pt-[68px] lg:pb-28 lg:pt-[76px]">
            {children}
          </main>

          <PlayerBar />
          <NowPlayingHost />
          <MobileNav />
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
