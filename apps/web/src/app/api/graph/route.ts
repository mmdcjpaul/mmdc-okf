import { NextResponse } from "next/server";
import { getFeatures, graphData, listNamespaces, listTerms } from "@lore/db";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";

/**
 * The notes the caller can read and the links between them, for the global graph (LB-10).
 * Compact on purpose: a vault of 20,000 notes is a little over a megabyte before compression.
 */
export async function GET() {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!(await getFeatures(db())).graph)
    return NextResponse.json({ error: "The graph is switched off" }, { status: 404 });
  const [data, namespaces, terms] = await Promise.all([
    graphData(db(), ctx.scope),
    listNamespaces(db(), ctx.vault.id),
    listTerms(db(), ctx.vault.id),
  ]);
  const index = new Map(data.notes.map((n, i) => [n.id, i]));
  const used = new Set(data.notes.map((n) => n.namespace));
  const themes = new Set(data.notes.flatMap((n) => n.themes.slice(0, 1)));
  return NextResponse.json(
    {
      // id, slug, title, type, namespace, first theme
      nodes: data.notes.map((n) => [n.id, n.slug, n.title, n.type, n.namespace, n.themes[0] ?? ""]),
      edges: data.links.map((l) => [index.get(l.source)!, index.get(l.target)!]),
      namespaces: namespaces
        .filter((n) => used.has(n.slug))
        .map((n) => ({ slug: n.slug, title: n.title })),
      themes: terms
        .filter((t) => t.kind === "theme" && themes.has(t.slug))
        .map((t) => ({ slug: t.slug, title: t.title })),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
