import { NextResponse, type NextRequest } from "next/server";
import { getChangeset, getIngestItem } from "@lore/db";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";
import { canProcessItem, canSeeItem } from "@/lib/ingest";
import { crossSite } from "@/lib/same-origin";
import { requestIngest } from "@/lib/worker";

/** Where an upload or capture is, for the page that waits on it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const item = await getIngestItem(db(), (await params).id);
  if (!item || !canSeeItem(ctx, item))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const cs = item.changesetId ? await getChangeset(db(), item.changesetId) : null;
  return NextResponse.json(
    {
      id: item.id,
      state: item.state,
      reason: item.stateReason,
      changesetId: item.changesetId,
      changesetState: cs?.state ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Process now: a writer in the namespace starts processing a queued item (AU-6). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;
  const item = await getIngestItem(db(), (await params).id);
  if (!item || !canSeeItem(ctx, item))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canProcessItem(ctx, item))
    return NextResponse.json(
      {
        error: ["queued", "waiting"].includes(item.state)
          ? "Only writers in the namespace can start processing"
          : "This item is already being processed",
      },
      { status: ["queued", "waiting"].includes(item.state) ? 403 : 409 },
    );
  return NextResponse.json({ id: item.id, queued: await requestIngest(item.id) }, { status: 202 });
}
