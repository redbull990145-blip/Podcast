import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <PageShell>
      <PageHeader
        title="Discover"
        description="Two catalogues plus raw RSS, so independent shows actually surface."
      />

      <div className="mt-8">
        {/* Phase 1 adds search; Phase 4 adds explained recommendations. */}
        <EmptyState
          Icon={Compass}
          title="Search is coming next"
          description="This is where podcast search, category browsing and add-by-RSS will live, followed by recommendations that tell you why they picked each show."
        />
      </div>
    </PageShell>
  );
}
