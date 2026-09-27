import { NextResponse, type NextRequest } from "next/server";
import { markNotificationsRead } from "@lore/db";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";

/** Marks the person's notifications as read. */
export async function POST(req: NextRequest) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  await markNotificationsRead(db(), ctx.principal.user.id, "all");
  return NextResponse.json({ ok: true });
}
