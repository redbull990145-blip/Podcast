import type { Metadata } from "next";
import { ListMusic } from "lucide-react";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";

export const metadata: Metadata = { title: "Up Next" };

export default function QueuePage() {
  return (
    <PageShell>
      <PageHeader
        title="Up Next"
        description="Drag to reorder, or use the keyboard. Syncs to your other devices."
      />

      <div className="mt-8">
        <EmptyState
          Icon={ListMusic}
          title="Your queue is empty"
          description="Add episodes from any show and they'll line up here, in the order you want them."
        />
      </div>
    </PageShell>
  );
}
