import { NextResponse, type NextRequest } from "next/server";
import { getNote } from "@lore/db";
import { z } from "zod";
import { apiContext } from "@/lib/context";
import { db } from "@/lib/db";
import { renderPreview } from "@/lib/preview";

const Body = z.object({
  body: z.string().max(200_000),
  /** The note being edited, or the namespace of a note that does not exist yet. */
  noteId: z.string().optional(),
  namespace: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  pendingAssets: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9._-]*$/))
    .max(10)
    .default([]),
});

/** Renders the editor's text exactly as the note page will. */
export async function POST(req: NextRequest) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { body, noteId, namespace, pendingAssets } = parsed.data;
  const root = ctx.vault.bundleRoot.replace(/\/+$/, "");

  let notePath: string;
  let ns: string | null;
  if (noteId) {
    const note = await getNote(db(), ctx.scope, noteId);
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
    notePath = note.path;
    ns = note.namespace;
  } else if (namespace && ctx.scope.namespaces.includes(namespace)) {
    notePath = `${root}/${namespace}/new-note.md`;
    ns = namespace;
  } else return NextResponse.json({ error: "Not found" }, { status: 404 });

  const html = await renderPreview({
    bundleRoot: root,
    notePath,
    body,
    scope: ctx.scope,
    pendingAssets: ns ? pendingAssets.map((name) => `${root}/${ns}/_assets/${name}`) : [],
  });
  return NextResponse.json({ html }, { headers: { "cache-control": "no-store" } });
}
