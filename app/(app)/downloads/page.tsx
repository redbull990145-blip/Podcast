import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/ui/page";
import { DownloadsList } from "@/components/downloads/downloads-list";

export const metadata: Metadata = { title: "Downloads" };

export default function DownloadsPage() {
  return (
    <PageShell className="max-w-[820px]">
      <PageHeader
        title="Downloads"
        description="Stored in this browser only. Everything here plays with the network off, and none of it counts against any account limit."
      />

      <div className="mt-7">
        <DownloadsList />
      </div>
    </PageShell>
  );
}
