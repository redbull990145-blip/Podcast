import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Library, Rss } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, user.id),
    with: { podcast: true },
    orderBy: (s, { desc }) => [desc(s.subscribedAt)],
  });

  return (
    <PageShell>
      <PageHeader
        title="Library"
        description={
          rows.length > 0
            ? `${rows.length} show${rows.length === 1 ? "" : "s"} you follow.`
            : "Shows you follow will appear here."
        }
        action={
          rows.length > 0 ? (
            <Link href="/discover">
              <Button size="sm" variant="secondary">
                Add a show
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="mt-8">
        {rows.length === 0 ? (
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
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map(({ podcast }) => (
              <li key={podcast.id}>
                <Link
                  href={`/podcast/${podcast.id}`}
                  className="group block focus-visible:outline-none"
                >
                  {podcast.artworkUrl ? (
                    <Image
                      src={podcast.artworkUrl}
                      alt=""
                      width={400}
                      height={400}
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 220px"
                      className="aspect-square w-full rounded-xl object-cover shadow-[var(--shadow-soft)] transition-all duration-200 group-hover:shadow-[var(--shadow-lifted)] group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-2"
                    />
                  ) : (
                    <span className="grid aspect-square w-full place-items-center rounded-xl bg-accent-subtle text-accent">
                      <Rss className="size-8" />
                    </span>
                  )}
                  <h2 className="mt-2 line-clamp-2 text-sm font-medium leading-snug group-hover:text-accent">
                    {podcast.title}
                  </h2>
                  {podcast.author && (
                    <p className="truncate text-xs text-muted-foreground">
                      {podcast.author}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
