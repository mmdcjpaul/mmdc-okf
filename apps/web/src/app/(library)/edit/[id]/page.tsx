import type { Metadata } from "next";
import { getNote } from "@lore/db";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { publishes } from "@/lib/changesets";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { editorNote, limitsOf, mergeFor, vocabulary } from "@/lib/editor";
import { noteHref, termHref } from "@/lib/urls";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; review?: string; resolves?: string | string[] }>;
}

export const metadata: Metadata = { title: "Edit" };

/** Edit for writers, Suggest an edit for everyone else. Both open the same editor (PRD 7.5). */
export default async function EditPage({ params, searchParams }: Props) {
  const ctx = await requireContext();
  const found = await getNote(db(), ctx.scope, decodeURIComponent((await params).id));
  if (!found) hidden();
  const query = await searchParams;
  const merged = query.review
    ? await mergeFor(ctx, found, query.review, "review")
    : query.from
      ? await mergeFor(ctx, found, query.from, "own")
      : null;
  // A link to a changeset the person cannot continue is a dead end, not a blank editor.
  if ((query.review || query.from) && !merged) hidden();
  const resolves = [query.resolves ?? []].flat().filter((r) => /^fb_[0-9A-Z]{26}$/.test(r));

  return (
    <NoteEditor
      mode="edit"
      note={merged?.note ?? editorNote(found)}
      {...(merged ? { merge: merged.merge } : {})}
      vocabulary={await vocabulary(ctx.vault)}
      bundleRoot={ctx.vault.bundleRoot.replace(/\/+$/, "")}
      writes={publishes(ctx.principal, found.namespace)}
      resolves={resolves}
      cancelHref={found.hubKind ? termHref(found.hubKind, found.slug) : noteHref(found)}
      limits={limitsOf(ctx)}
    />
  );
}
