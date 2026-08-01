import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { PageHeader, PageShell } from "@/components/ui/page";
import { QueueList } from "@/components/queue/queue-list";

export const metadata: Metadata = { title: "Up Next" };

export default async function QueuePage() {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <PageShell className="max-w-[820px]">
      <PageHeader
        title="Up Next"
        description="Drag the handle to reorder, or focus it and use space then the arrow keys. It syncs across your devices within seconds."
      />

      <div className="mt-6">
        <QueueList userId={user.id} />
      </div>
    </PageShell>
  );
}
