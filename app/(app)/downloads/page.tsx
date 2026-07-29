import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/ui/page";
import { DownloadsList } from "@/components/downloads/downloads-list";

export const metadata: Metadata = { title: "Downloads" };

export default function DownloadsPage() {
  return (
    <PageShell>
      <PageHeader
        title="Downloads"
        description="Stored in this browser only. We never upload your audio anywhere, and downloads don't count against any account limit."
      />

      <div className="mt-8">
        <DownloadsList />
      </div>
    </PageShell>
  );
}
