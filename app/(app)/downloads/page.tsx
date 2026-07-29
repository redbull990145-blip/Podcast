import type { Metadata } from "next";
import { Download } from "lucide-react";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";

export const metadata: Metadata = { title: "Downloads" };

export default function DownloadsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Downloads"
        description="Stored on this device only — we never upload your audio anywhere."
      />

      <div className="mt-8">
        <EmptyState
          Icon={Download}
          title="Nothing downloaded"
          description="Downloaded episodes are kept in this browser's storage so they play with no connection at all."
        />
      </div>
    </PageShell>
  );
}
