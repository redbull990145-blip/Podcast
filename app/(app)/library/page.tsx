import Link from "next/link";
import type { Metadata } from "next";
import { Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <PageShell>
      <PageHeader
        title="Library"
        description="Shows you follow and episodes waiting for you."
      />

      <div className="mt-8">
        {/* Phase 1 replaces this with the real subscription grid. */}
        <EmptyState
          Icon={Library}
          title="No subscriptions yet"
          description="Search for a show, or paste an RSS feed URL directly — both work, and neither is buried behind a menu."
          action={
            <Link href="/discover">
              <Button>Find podcasts</Button>
            </Link>
          }
        />
      </div>
    </PageShell>
  );
}
