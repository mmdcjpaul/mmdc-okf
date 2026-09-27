import { NextResponse, type NextRequest } from "next/server";
import { follow, getNote, getTerm, isFollowTarget, unfollow } from "@lore/db";
import { z } from "zod";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";
import { crossSite } from "@/lib/same-origin";

const Body = z.object({
  /** A note id, or a hub as `theme:<slug>` or `system:<slug>`. */
  target: z.string().min(1).max(80).refine(isFollowTarget, "Not something that can be followed"),
  follow: z.boolean(),
});

/** Follows or stops following a note or a hub the person can read (LB-9). */
export async function POST(req: NextRequest) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  const { target } = parsed.data;
  const me = ctx.principal.user.id;
  if (!parsed.data.follow) {
    // Always allowed: a person who lost access must still be able to stop following.
    await unfollow(db(), me, ctx.vault.id, target);
    return NextResponse.json({ following: false });
  }
  const hub = /^(theme|system):(.+)$/.exec(target);
  const found = hub
    ? await getTerm(db(), ctx.vault.id, hub[1] as "theme" | "system", hub[2]!)
    : await getNote(db(), ctx.scope, target);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await follow(db(), me, ctx.vault.id, target);
  return NextResponse.json({ following: true });
}
