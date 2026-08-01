import type { Metadata } from "next";
import { getUser } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { PageHeader, PageShell, SectionLabel } from "@/components/ui/page";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { OpmlPanel } from "@/components/settings/opml-panel";
import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { PowerModeToggle } from "@/components/power-mode/power-mode-toggle";
import { ShortcutsButton } from "@/components/power-mode/shortcuts-button";
import { AudioEnhancementsPanel } from "@/components/settings/audio-enhancements-panel";
import { ArtworkMotionControl } from "@/components/settings/artwork-motion-control";

export const metadata: Metadata = { title: "Settings" };

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <SectionLabel className="tracking-[0.12em]">{label}</SectionLabel>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border-3 py-5 last:border-0">
      <div className="min-w-0 max-w-[44ch]">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-2">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export default async function SettingsPage() {
  const user = await getUser();

  return (
    <PageShell className="max-w-[720px]">
      <PageHeader title="Settings" />

      <Section label="Motion & atmosphere">
        <Row
          title="Living artwork"
          description="While an episode plays, its cover is lit from within — light and colour drifting very slowly, and the player's ambient backdrop drifting with it. Neither moves anything you are reading, and both settle when you pause."
        >
          <ArtworkMotionControl />
        </Row>
      </Section>

      <Section label="Appearance">
        <Row
          title="Theme"
          description="Follow your system, or pin it to light or dark."
        >
          <ThemeToggle />
        </Row>
      </Section>

      <Section label="Playback">
        <AudioEnhancementsPanel />
      </Section>

      <Section label="Interface">
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
      </Section>

      <Section label="AI">
        <ApiKeysPanel />
      </Section>

      <Section label="Your data">
        <OpmlPanel />
      </Section>

      <Section label="Account">
        <Row title="Signed in as" description={user?.email ?? ""}>
          {/*
            A server action rather than a fetch, so signing out works with
            JavaScript unavailable — which is the one moment it most needs to.
          */}
          <form action={signOut}>
            {/*
              The shared Button rather than a bare <button>, so this presses
              like every other control in the app. It is still a real form
              submit — Button forwards `type`.
            */}
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-clay hover:bg-clay-subtle hover:text-clay-ink"
            >
              Sign out
            </Button>
          </form>
        </Row>
      </Section>
    </PageShell>
  );
}
