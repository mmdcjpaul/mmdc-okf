import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAsset } from "@lore/db";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Serves a vault asset after checking that its namespace is readable. Unreadable and missing
 * assets both 404. In production this redirects to a short-lived signed bucket URL instead.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await apiContext();
  if (!session) return new NextResponse("Not found", { status: 404 });
  const path = (await ctx.params).path.map(decodeURIComponent).join("/");
  const asset = await getAsset(db(), session.scope, path);
  if (!asset || !/^[0-9a-f]{40,64}$/.test(asset.blobSha))
    return new NextResponse("Not found", { status: 404 });
  try {
    const bytes = await readFile(
      join(env().DATA_DIR, "objects", asset.blobSha.slice(0, 2), asset.blobSha.slice(2)),
    );
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": asset.mime,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        // SVGs can carry script; never let an asset run as a document.
        "content-security-policy":
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
