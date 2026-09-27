import { NextResponse, type NextRequest } from "next/server";
import { getAsset } from "@lore/db";
import { blobKey } from "@lore/ingest";
import { apiContext } from "@/lib/context";
import { db, objects } from "@/lib/db";

/** Long enough to load a page's images, short enough that a copied link soon stops working. */
const URL_LIFETIME_S = 300;

/**
 * Serves a vault asset: checks that its namespace is readable, then redirects to a
 * short-lived signed URL. Unreadable and missing assets both 404.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await apiContext();
  if (!session) return new NextResponse("Not found", { status: 404 });
  const path = (await ctx.params).path.map(decodeURIComponent).join("/");
  const asset = await getAsset(db(), session.scope, path);
  if (!asset) return new NextResponse("Not found", { status: 404 });
  let url: string | null;
  try {
    url = await objects().signedUrl(blobKey(asset.blobSha), {
      expiresIn: URL_LIFETIME_S,
      // SVGs can carry script. Served as plain images they are inert in an <img>, and the
      // store's origin is not the Library's, so opening one directly cannot reach a session.
      contentType: asset.mime,
    });
  } catch {
    url = null;
  }
  if (!url) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(null, {
    status: 307,
    headers: {
      location: url,
      // The redirect is per person and expires; the browser may reuse it until just before then.
      "cache-control": `private, max-age=${URL_LIFETIME_S - 60}`,
    },
  });
}
