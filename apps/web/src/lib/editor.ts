import "server-only";
import { canOn } from "@lore/auth";
import { getChangeset, listNamespaces, type NoteRow } from "@lore/db";
import { parseNote } from "@lore/okf";
import type { EditorNote, NoteEditorProps } from "@/components/editor/NoteEditor";
import { canApproveChangeset, vocabulary } from "./changesets";
import type { RequestContext } from "./context";
import { db } from "./db";
import { mergeBodies } from "./merge";
import { fetchBlob, fetchFile } from "./worker";

export function limitsOf(ctx: RequestContext): NoteEditorProps["limits"] {
  const l = (ctx.vault.profile as { limits?: Record<string, number> }).limits ?? {};
  return {
    imageMaxMb: l.image_max_mb ?? 2,
    wordsWarn: l.words_warn ?? 1200,
    wordsError: l.words_error ?? 2500,
  };
}

export function editorNote(note: NoteRow): EditorNote {
  return {
    id: note.id,
    slug: note.slug,
    namespace: note.namespace,
    path: note.path,
    blobSha: note.blobSha,
    data: note.frontmatter,
    // Stored without the blank line that separates it from the frontmatter.
    body: note.body.replace(/^\n+/, ""),
    isHub: note.hubKind !== null,
  };
}

export async function namespacesFor(ctx: RequestContext) {
  const all = await listNamespaces(db(), ctx.vault.id);
  return all
    .filter((n) => ctx.scope.namespaces.includes(n.slug))
    .map((n) => ({
      slug: n.slug,
      title: n.title,
      writes: canOn(ctx.principal, n.slug, "write"),
    }))
    .sort((a, b) => Number(b.writes) - Number(a.writes) || a.title.localeCompare(b.title));
}

/**
 * What the editor starts from when it continues an earlier changeset: the writer's version
 * merged with the version now in the vault.
 *
 * `own` continues the person's own changeset that came back to them (conflicted, did not
 * validate, or a reviewer asked for changes); saving makes a new changeset. `review` is a
 * reviewer editing a suggestion before approving it; saving updates that changeset, so the
 * commit still credits the person who suggested it.
 *
 * Null when the changeset is not an edit of this note that the person may continue.
 */
export async function mergeFor(
  ctx: RequestContext,
  note: NoteRow,
  changesetId: string,
  mode: "own" | "review",
): Promise<{ merge: NonNullable<NoteEditorProps["merge"]>; note: EditorNote } | null> {
  const cs = await getChangeset(db(), changesetId);
  if (!cs || cs.vaultId !== ctx.vault.id) return null;
  if (mode === "own") {
    if (cs.submitterId !== ctx.principal.user.id) return null;
    if (!["conflicted", "draft", "changes_requested"].includes(cs.state)) return null;
  } else if (!canApproveChangeset(ctx.principal, cs)) return null;
  const intent = cs.intents.find((i) => i.type === "edit" && i.path === note.path);
  if (!intent || intent.type !== "edit") return null;
  const baseSha = cs.baseShas[note.path];
  const [baseText, current] = await Promise.all([
    baseSha ? fetchBlob(ctx.vault.id, baseSha) : Promise.resolve(null),
    fetchFile(ctx.vault.id, note.path),
  ]);
  if (!current?.text || !current.blobSha) return null;
  const clean = (text: string) => parseNote(text, note.path).body.replace(/^\n+/, "");
  const theirs = parseNote(current.text, note.path);
  const merged = mergeBodies(
    baseText ? clean(baseText) : "",
    intent.body ?? clean(baseText ?? ""),
    theirs.body.replace(/^\n+/, ""),
  );
  return {
    merge: {
      changesetId,
      mode,
      moved: baseSha !== current.blobSha,
      body: merged.text,
      set: Object.fromEntries(
        Object.entries(intent.set ?? {}).concat((intent.unset ?? []).map((k) => [k, ""])),
      ),
      conflicts: merged.conflicts,
      changeClass: cs.changeClass,
      reason: cs.reason,
      summary: cs.summary,
    },
    // The form and the base now follow the vault: the writer's changes sit on top of theirs.
    note: {
      ...editorNote(note),
      blobSha: current.blobSha,
      data: theirs.data,
      body: theirs.body.replace(/^\n+/, ""),
    },
  };
}

/**
 * A new note that came back to its author: a draft from an upload that still needs a theme,
 * say. Returns what the new-note form starts from, or null when the changeset is not the
 * person's own and waiting for them.
 */
export async function createFrom(
  ctx: RequestContext,
  changesetId: string,
): Promise<{ namespace: string; data: Record<string, unknown>; body: string } | null> {
  const cs = await getChangeset(db(), changesetId);
  if (!cs || cs.vaultId !== ctx.vault.id || cs.submitterId !== ctx.principal.user.id) return null;
  if (!["draft", "changes_requested"].includes(cs.state)) return null;
  // The note a person finishes, not the Source Document that goes with it.
  const intent = cs.intents.find((i) => i.type === "create" && i.folder !== "references");
  if (!intent || intent.type !== "create") return null;
  if (!ctx.scope.namespaces.includes(intent.namespace)) return null;
  return { namespace: intent.namespace, data: intent.data, body: intent.body };
}

export { vocabulary };
