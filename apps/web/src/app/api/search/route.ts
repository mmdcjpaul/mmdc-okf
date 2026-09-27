import { NextResponse, type NextRequest } from "next/server";
import { searchNotes } from "@lore/search";
import { apiContext } from "@/lib/context";
import { embedQuery, meili } from "@/lib/db";
import { noteHref } from "@/lib/urls";

/** Cmd-K search. Filtered by the caller's readable namespaces on the server. */
export async function GET(req: NextRequest) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 10) || 10, 30);
  const vector = await embedQuery(q);
  try {
    const res = await searchNotes(meili(), {
      vaultSlug: ctx.vault.slug,
      scope: ctx.scope,
      q,
      vector,
      limit,
    });
    return NextResponse.json({
      keywordOnly: !vector,
      hits: res.hits.map((h) => ({
        id: h.id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        type: h.type,
        namespace: h.namespace,
        // Repository path, so the editor can write a standard link to the note.
        path: h.path,
        href: noteHref(h),
      })),
    });
  } catch {
    return NextResponse.json({ error: "Search is unavailable" }, { status: 503 });
  }
}
