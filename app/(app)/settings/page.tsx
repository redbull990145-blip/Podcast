import type { Metadata } from "next";
import { getUser } from "@/lib/supabase/server";
import { PageHeader, PageShell } from "@/components/ui/page";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { OpmlPanel } from "@/components/settings/opml-panel";
import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { PowerModeToggle } from "@/components/power-mode/power-mode-toggle";
import { ShortcutsButton } from "@/components/power-mode/shortcuts-button";
import { AudioEnhancementsPanel } from "@/components/settings/audio-enhancements-panel";

export const metadata: Metadata = { title: "Settings" };

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5 last:border-0">
      <div className="min-w-0 max-w-md">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await getUser();

  return (
    <PageShell className="max-w-3xl">
      <PageHeader title="Settings" />

      <section className="mt-4">
        <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          Account
        </h2>
        <Row title="Signed in as" description={user?.email ?? ""} />
      </section>

      <section className="mt-8">
        <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          Appearance
        </h2>
        <Row
          title="Theme"
          description="Follow your system, or pin it to light or dark."
        >
          <ThemeToggle />
        </Row>
      </section>

      <section className="mt-8">
        <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          Your data
        </h2>
        <OpmlPanel />
      </section>

      <section className="mt-8">
        <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          AI
        </h2>
        <ApiKeysPanel />
      </section>

      <section className="mt-8">
        <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          Interface
        </h2>
        <Row
          title="Power user mode"
          description="Reveals keyboard shortcuts, episode filters and the audio enhancements. Free — it only controls how much is on screen."
        >
          <PowerModeToggle />
        </Row>
        <Row
          title="Keyboard shortcuts"
          description="Press ? at any time to see the full list."
        >
          <ShortcutsButton />
        </Row>
      </section>

      <section className="mt-8">
        <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
          Audio
        </h2>
        <AudioEnhancementsPanel />
      </section>
    </PageShell>
  );
}
