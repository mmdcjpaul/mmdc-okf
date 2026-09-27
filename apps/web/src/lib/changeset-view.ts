import "server-only";
import { stripMembersBlock } from "@lore/changesets";
import { getNoteByPath, getUser, reviewsOf, type ChangesetRow } from "@lore/db";
import { parseNote } from "@lore/okf";
import { searchNotes } from "@lore/search";
import type { RequestContext } from "./context";
import { db, embedQuery, meili } from "./db";
import { diffNote, type NoteDiff } from "./diff";
import { renderPreview } from "./preview";
import { noteHref } from "./urls";
import { fetchFile } from "./worker";

export interface FileView {
  path: string;
  kind: "note" | "image" | "file";
  change: "added" | "changed" | "deleted";
  /** True when the submitter changed this file; false for side effects such as rewritten links. */
  primary: boolean;
  title: string;
  diff: NoteDiff | null;
  /** The note as it will read, for notes the submitter changed. */
  rendered: string | null;
  bytes: number | null;
}

export interface SimilarNote {
  id: string;
  title: string;
  description: string;
  href: string;
  namespace: string | null;
}

const MAX_FILES = 40;

/** Paths the submitter meant to change, from what they sent. */
function primaryPaths(cs: ChangesetRow): Set<string> {
  const out = new Set<string>();
  for (const op of cs.ops) out.add(op.path);
  for (const i of cs.intents) {
    if (i.type === "edit" || i.type === "delete" || i.type === "deprecate" || i.type === "verify")
      out.add(i.path);
    if (i.type === "move") {
      out.add(i.from);
      out.add(i.to);
    }
  }
  return out;
}

/**
 * What a changeset does, file by file: the diff against the head it was prepared on, and
 * how the changed notes will read. Hub member lists are left out, as everywhere.
 */
export async function changesetFiles(ctx: RequestContext, cs: ChangesetRow): Promise<FileView[]> {
  const ops = cs.finalOps ?? [];
  const primary = primaryPaths(cs);
  const created = cs.intents.some((i) => i.type === "create");
  const root = ctx.vault.bundleRoot.replace(/\/+$/, "");
  const sorted = [...ops].sort((a, b) => {
    const pa = primary.has(a.path) || (created && a.op === "put") ? 0 : 1;
    const pb = primary.has(b.path) || (created && b.op === "put") ? 0 : 1;
    return pa - pb || a.path.localeCompare(b.path);
  });

  const out: FileView[] = [];
  for (const op of sorted.slice(0, MAX_FILES)) {
    const isImage = /\/_assets\//.test(op.path) || (op.op === "put" && op.encoding === "base64");
    const before =
      !isImage && cs.preparedHead
        ? ((await fetchFile(ctx.vault.id, op.path, cs.preparedHead))?.text ?? null)
        : null;
    const after = op.op === "put" && !isImage ? stripMembersBlock(op.content) : null;
    const isNote = op.path.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(op.path);
    const parsed = after !== null && isNote ? parseNote(after, op.path) : null;
    const old = before !== null && isNote ? parseNote(before, op.path) : null;
    const isPrimary =
      primary.has(op.path) || (before === null && op.op === "put" && isNote && !isImage);
    out.push({
      path: op.path,
      kind: isImage ? "image" : isNote ? "note" : "file",
      change: op.op === "delete" ? "deleted" : before === null ? "added" : "changed",
      primary: isPrimary,
      title:
        (parsed?.data.title as string | undefined) ??
        (old?.data.title as string | undefined) ??
        op.path.slice(op.path.lastIndexOf("/") + 1),
      diff: isImage ? null : diffNote(before, after),
      rendered:
        parsed && isPrimary
          ? await renderPreview({
              bundleRoot: root,
              notePath: op.path,
              body: parsed.body,
              scope: ctx.scope,
              pendingAssets: ops.filter((o) => o.op === "put").map((o) => o.path),
            })
          : null,
      bytes: op.op === "put" && isImage ? Math.floor((op.content.length * 3) / 4) : null,
    });
  }
  return out;
}

/** Existing notes that resemble the ones a changeset adds, to catch duplicates in review. */
export async function similarTo(ctx: RequestContext, files: FileView[]): Promise<SimilarNote[]> {
  const added = files.filter((f) => f.kind === "note" && f.change === "added" && f.primary);
  const seen = new Set<string>();
  const out: SimilarNote[] = [];
  for (const f of added.slice(0, 3)) {
    try {
      const res = await searchNotes(meili(), {
        vaultSlug: ctx.vault.slug,
        scope: ctx.scope,
        q: f.title,
        vector: await embedQuery(f.title),
        limit: 4,
      });
      for (const h of res.hits) {
        if (seen.has(h.id) || h.path === f.path) continue;
        seen.add(h.id);
        out.push({
          id: h.id,
          title: h.title,
          description: h.description,
          href: noteHref(h),
          namespace: h.namespace,
        });
      }
    } catch {
      // Search being down must not block a review.
    }
  }
  return out.slice(0, 6);
}

export async function changesetPeople(cs: ChangesetRow) {
  const [submitter, reviews] = await Promise.all([
    cs.submitterId ? getUser(db(), cs.submitterId) : Promise.resolve(null),
    reviewsOf(db(), cs.id),
  ]);
  return { submitter, reviews };
}

/** The note a changeset is about, when the reader can see it, for links back. */
export async function changesetNote(ctx: RequestContext, cs: ChangesetRow) {
  for (const path of Object.keys(cs.baseShas)) {
    const note = await getNoteByPath(db(), ctx.scope, path);
    if (note) return note;
  }
  for (const i of cs.intents) {
    if ("path" in i) {
      const note = await getNoteByPath(db(), ctx.scope, i.path);
      if (note) return note;
    }
  }
  return null;
}
