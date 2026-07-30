import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { PageHeader, PageShell } from "@/components/ui/page";
import { DiscoverPanel } from "@/components/podcasts/discover-panel";
import { RecommendationsPanel } from "@/components/podcasts/recommendations-panel";

export const metadata: Metadata = { title: "Discover" };

export default async function DiscoverPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // Passed down so search results can render "Following" without a second
  // round-trip per card.
  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, user.id),
    with: { podcast: { columns: { feedUrl: true } } },
  });

  return (
    <PageShell>
      <PageHeader
        title="Discover"
        description="Searches Apple's catalogue and the independent Podcast Index at once."
      />

      <div className="mt-8 space-y-10">
        <DiscoverPanel subscribedFeedUrls={rows.map((r) => r.podcast.feedUrl)} />
        <RecommendationsPanel />
      </div>
    </PageShell>
  );
}
