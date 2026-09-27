import { NextResponse, type NextRequest } from "next/server";
import { setPrefs } from "@lore/db";
import { z } from "zod";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";
import { crossSite } from "@/lib/same-origin";

const Body = z
  .object({ emailNotifications: z.boolean(), emailDigest: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

/** What the person wants by email. */
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
  const patch: { emailNotifications?: boolean; emailDigest?: boolean } = {};
  if (parsed.data.emailNotifications !== undefined)
    patch.emailNotifications = parsed.data.emailNotifications;
  if (parsed.data.emailDigest !== undefined) patch.emailDigest = parsed.data.emailDigest;
  await setPrefs(db(), ctx.principal.user.id, patch);
  return NextResponse.json({ ok: true });
}
