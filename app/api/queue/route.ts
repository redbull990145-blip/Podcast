import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getUser } from "@/lib/supabase/server";
import { db } from "@/lib/db/client";
import { queueItems } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * "Up Next".
 *
 * Ordering uses a fractional index: to move an item, we write the midpoint
 * between its new neighbours and touch exactly one row. Renumbering the whole
 * list on every drag would multiply writes by queue length and make the
 * realtime sync flood other devices with changes that mean nothing.
 */

const POSITION_GAP = 1024;

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await db.query.queueItems.findMany({
    where: eq(queueItems.userId, user.id),
    with: { episode: { with: { podcast: true } } },
    orderBy: [asc(queueItems.position)],
  });

  return NextResponse.json({ queue: rows });
}

/** Adds an episode to the queue, at the end by default. */
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    episodeId?: string;
    /** "next" jumps the queue; "last" appends. */
    placement?: "next" | "last";
  } | null;

  const episodeId = body?.episodeId;
  if (!episodeId) {
    return NextResponse.json({ error: "An episode id is required." }, { status: 400 });
  }

  const existing = await db.query.queueItems.findMany({
    where: eq(queueItems.userId, user.id),
    orderBy: [asc(queueItems.position)],
    columns: { position: true },
  });

  const position =
    body?.placement === "next"
      ? existing.length === 0
        ? POSITION_GAP
        : existing[0].position / 2
      : existing.length === 0
        ? POSITION_GAP
        : existing[existing.length - 1].position + POSITION_GAP;

  const [row] = await db
    .insert(queueItems)
    .values({ userId: user.id, episodeId, position })
    .onConflictDoUpdate({
      // Re-queueing an episode already in the list moves it rather than
      // erroring or silently doing nothing.
      target: [queueItems.userId, queueItems.episodeId],
      set: { position },
    })
    .returning();

  return NextResponse.json({ item: row });
}

/** Reorders one item by writing the midpoint between its new neighbours. */
export async function PATCH(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    itemId?: string;
    /** Positions of the items that will sit either side after the move. */
    beforePosition?: number | null;
    afterPosition?: number | null;
  } | null;

  if (!body?.itemId) {
    return NextResponse.json({ error: "An item id is required." }, { status: 400 });
  }

  const before = body.beforePosition ?? null;
  const after = body.afterPosition ?? null;

  let position: number;
  if (before == null && after == null) {
    position = POSITION_GAP;
  } else if (before == null) {
    position = after! / 2;
  } else if (after == null) {
    position = before + POSITION_GAP;
  } else {
    position = (before + after) / 2;
  }

  // Doubles run out of room after ~50 consecutive midpoint splits in the same
  // gap. Rebalancing is rare enough to be worth the occasional full rewrite.
  if (before != null && after != null && Math.abs(after - before) < 1e-6) {
    const all = await db.query.queueItems.findMany({
      where: eq(queueItems.userId, user.id),
      orderBy: [asc(queueItems.position)],
    });
    for (const [index, item] of all.entries()) {
      await db
        .update(queueItems)
        .set({ position: (index + 1) * POSITION_GAP })
        .where(eq(queueItems.id, item.id));
    }
    return NextResponse.json({ ok: true, rebalanced: true });
  }

  await db
    .update(queueItems)
    .set({ position })
    .where(and(eq(queueItems.id, body.itemId), eq(queueItems.userId, user.id)));

  return NextResponse.json({ ok: true, position });
}

export async function DELETE(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const itemId = request.nextUrl.searchParams.get("itemId");
  const episodeId = request.nextUrl.searchParams.get("episodeId");

  if (!itemId && !episodeId) {
    return NextResponse.json(
      { error: "An item or episode id is required." },
      { status: 400 },
    );
  }

  await db
    .delete(queueItems)
    .where(
      and(
        eq(queueItems.userId, user.id),
        itemId ? eq(queueItems.id, itemId) : eq(queueItems.episodeId, episodeId!),
      ),
    );

  return NextResponse.json({ ok: true });
}
