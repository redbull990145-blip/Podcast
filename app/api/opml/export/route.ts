import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { buildOpml } from "@/lib/opml/opml";

export const runtime = "nodejs";

/**
 * Exports every subscription as OPML.
 *
 * No paywall, no confirmation, no "are you sure you want to leave" — this is a
 * plain GET that returns a file. Being able to walk away with your library is
 * the point.
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await db.query.subscriptions.findMany({
    where: eq(subscriptions.userId, user.id),
    with: { podcast: true },
    orderBy: (s, { asc }) => [asc(s.subscribedAt)],
  });

  const xml = buildOpml(
    rows.map((r) => ({
      feedUrl: r.podcast.feedUrl,
      title: r.podcast.title,
      htmlUrl: r.podcast.link,
    })),
  );

  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(xml, {
    headers: {
      "content-type": "text/x-opml+xml; charset=utf-8",
      "content-disposition": `attachment; filename="cadence-subscriptions-${date}.opml"`,
      "cache-control": "no-store",
    },
  });
}
