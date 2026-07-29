import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { MobileNav } from "@/components/nav/mobile-nav";
import { PlayerProvider } from "@/components/player/player-provider";
import { PlayerBar } from "@/components/player/player-bar";

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

  return (
    <ThemeProvider>
      <QueryProvider>
        <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
          <AppSidebar
            email={user.email ?? ""}
            displayName={
              (user.user_metadata?.full_name as string | undefined) ??
              user.email?.split("@")[0] ??
              "You"
            }
          />

          {/* Bottom padding clears the mobile tab bar and the docked player. */}
          <main className="min-w-0 pb-40 lg:pb-28">{children}</main>

          <PlayerBar />
          <MobileNav />
          {/* Headless: owns the audio element, position sync and OS controls. */}
          <PlayerProvider />
        </div>
      </QueryProvider>
    </ThemeProvider>
  );
}
