import { NextResponse, type NextRequest } from "next/server";
import { getChangeset, getNote, transitionChangeset, writeAudit } from "@lore/db";
import { z } from "zod";
import { canApproveChangeset, canSeeChangeset } from "@/lib/changesets";
import { apiContext } from "@/lib/context";
import { crossSite } from "@/lib/same-origin";
import { db } from "@/lib/db";
import { noteHref } from "@/lib/urls";
import { requestProcessing } from "@/lib/worker";

/** Where a changeset is, for the page that waits on it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const cs = await getChangeset(db(), (await params).id);
  if (!cs || !canSeeChangeset(ctx.principal, cs))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Committed is not the end for the reader: the note page shows the change once indexed.
  let indexed = false;
  let href: string | null = null;
  for (const id of cs.noteIds) {
    const note = await getNote(db(), ctx.scope, id);
    if (!note) continue;
    href ??= noteHref(note);
    if (cs.commitSha && note.lastCommitSha === cs.commitSha) indexed = true;
  }
  // A deleted note never appears in the index, so there is nothing to wait for.
  if (cs.state === "committed" && cs.intents.some((i) => i.type === "delete")) indexed = true;

  return NextResponse.json(
    {
      id: cs.id,
      state: cs.state,
      title: cs.title,
      error: cs.error,
      issues: cs.issues,
      conflicts: cs.conflicts,
      warnings: cs.warnings,
      reviewReasons: cs.reviewReasons,
      commitSha: cs.commitSha,
      indexed,
      href,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Withdraws a changeset that has not been committed: a draft that did not validate, a
 * conflicted edit the writer has merged into a new one, or a suggestion they changed their
 * mind about. Only its submitter can.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;
  const id = (await params).id;
  const cs = await getChangeset(db(), id);
  if (!cs || cs.vaultId !== ctx.vault.id || cs.submitterId !== ctx.principal.user.id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const done = await transitionChangeset(
    db(),
    id,
    ["draft", "conflicted", "in_review", "changes_requested"],
    "rejected",
    { error: "Withdrawn by its author" },
  );
  if (!done) return NextResponse.json({ error: `The change is ${cs.state}` }, { status: 409 });
  return NextResponse.json({ id, state: "rejected" });
}

const Key = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,60}$/);
const Edit = z.object({
  kind: z.literal("edit").default("edit"),
  noteId: z.string().min(1),
  baseSha: z.string().regex(/^[0-9a-f]{40,64}$/),
  body: z.string().max(200_000),
  set: z.record(Key, z.unknown()).default({}),
  unset: z.array(z.string()).max(40).default([]),
  changeClass: z.enum(["fix", "addition", "process"]),
  summary: z.string().trim().max(300).optional(),
});
const Create = z.object({
  kind: z.literal("create"),
  data: z.record(Key, z.unknown()),
  body: z.string().max(200_000),
});

/**
 * Changes what a changeset will write, keeping the changeset.
 *
 * A reviewer edits a suggestion before approving it: the changeset keeps its author, so the
 * commit credits them, and the reviewer is credited when they approve.
 *
 * An author finishes a new note that came back to them, such as a draft from an upload that
 * needs a theme: the rest of the changeset (the Source Document, the images) stays with it.
 *
 * Either way it goes through the pipeline again.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const refused = crossSite(req);
  if (refused) return refused;
  const id = (await params).id;
  const cs = await getChangeset(db(), id);
  if (!cs || cs.vaultId !== ctx.vault.id || !canSeeChangeset(ctx.principal, cs))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const json = (await req.json().catch(() => null)) as { kind?: string } | null;
  const me = ctx.principal.user.id;

  if (json?.kind === "create") {
    const parsed = Create.safeParse(json);
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    if (cs.submitterId !== me)
      return NextResponse.json({ error: "Only its author can finish this note" }, { status: 403 });
    const intent = cs.intents.find((i) => i.type === "create" && i.folder !== "references");
    if (!intent || intent.type !== "create")
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    const moved = await transitionChangeset(db(), id, ["draft", "changes_requested"], "submitted", {
      intents: cs.intents.map((i) =>
        i === intent ? { ...intent, data: parsed.data.data, body: parsed.data.body } : i,
      ),
      error: null,
      issues: [],
    });
    if (!moved) return NextResponse.json({ error: `This change is ${cs.state}` }, { status: 409 });
    return NextResponse.json({ id, queued: await requestProcessing(id) }, { status: 202 });
  }

  if (!canApproveChangeset(ctx.principal, cs))
    return NextResponse.json({ error: "You cannot edit this change" }, { status: 403 });
  const parsed = Edit.safeParse(json);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  const edit = parsed.data;
  const note = await getNote(db(), ctx.scope, edit.noteId);
  const intent = cs.intents.find((i) => i.type === "edit");
  // Only the note the suggestion is about, so an edit cannot be pointed somewhere else.
  if (!note || !intent || intent.type !== "edit" || intent.path !== note.path)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const moved = await transitionChangeset(db(), id, ["in_review"], "submitted", {
    intents: cs.intents.map((i) =>
      i === intent
        ? { type: "edit", path: note.path, body: edit.body, set: edit.set, unset: edit.unset }
        : i,
    ),
    baseShas: { ...cs.baseShas, [note.path]: edit.baseSha },
    changeClass: edit.changeClass,
    summary: edit.summary ?? cs.summary,
    error: null,
  });
  if (!moved)
    return NextResponse.json({ error: "This change is no longer in review" }, { status: 409 });
  await writeAudit(db(), {
    actorId: me,
    action: "changeset.edited_in_review",
    target: id,
  });
  return NextResponse.json({ id, queued: await requestProcessing(id) }, { status: 202 });
}
