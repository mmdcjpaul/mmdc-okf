import { NextResponse, type NextRequest } from "next/server";
import { markNotificationsRead } from "@lore/db";
import { apiContext } from "@/lib/context";
import { crossSite } from "@/lib/same-origin";
import { db } from "@/lib/db";

/** Marks the person's notifications as read. */
export async function POST(req: NextRequest) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;
  await markNotificationsRead(db(), ctx.principal.user.id, "all");
  return NextResponse.json({ ok: true });
}
