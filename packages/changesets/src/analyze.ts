import {
  hubKindOf,
  namespaceOf,
  str,
  trustTier,
  type FileOp,
  type ParsedNote,
  type Vault,
} from "@lore/okf";
import type { ChangesetFacts, NoteChange, TermChange } from "./types.ts";

const idOf = (note: ParsedNote) => str(note.data, "id") ?? `path:${note.path}`;

/**
 * Pairs each note after the change with the note it was before. A note at the same path is
 * the same note, whatever its id says now; a note at a new path is a move when its id
 * belonged to a note whose path is gone, and new otherwise.
 */
function pair(
  before: Vault,
  after: Vault,
): { pairs: [ParsedNote | null, ParsedNote][]; deleted: ParsedNote[] } {
  const pairs: [ParsedNote | null, ParsedNote][] = [];
  const gone = new Map<string, ParsedNote>();
  for (const [path, note] of before.notes) {
    if (!after.notes.has(path) && !gone.has(idOf(note))) gone.set(idOf(note), note);
  }
  const deleted = new Set([...before.notes.values()].filter((n) => !after.notes.has(n.path)));
  for (const [path, note] of after.notes) {
    const same = before.notes.get(path);
    if (same) {
      pairs.push([same, note]);
      continue;
    }
    const old = gone.get(idOf(note));
    if (old && deleted.has(old)) {
      deleted.delete(old);
      pairs.push([old, note]);
    } else pairs.push([null, note]);
  }
  return { pairs, deleted: [...deleted] };
}

function vocabulary(vault: Vault): Map<string, TermChange["kind"]> {
  const out = new Map<string, TermChange["kind"]>();
  for (const slug of Object.keys(vault.namespaces)) out.set(`namespace:${slug}`, "namespace");
  for (const slug of vault.themes.keys()) out.set(`theme:${slug}`, "theme");
  for (const slug of vault.systems.keys()) out.set(`system:${slug}`, "system");
  for (const slug of Object.keys(vault.tags)) out.set(`tag:${slug}`, "tag");
  return out;
}

const isAsset = (path: string) => path.split("/").includes("_assets");

/**
 * Compares the vault before and after a changeset. `primaryPaths` are the files the submitter
 * changed; everything else that differs is a side effect, such as a link rewritten by a move.
 */
export function analyzeChangeset(
  before: Vault,
  after: Vault,
  ops: FileOp[],
  primaryPaths: ReadonlySet<string>,
): ChangesetFacts {
  const { pairs, deleted } = pair(before, after);
  const notes: NoteChange[] = [];
  const root = after.root;

  for (const [old, note] of pairs) {
    const common = {
      // The id in Git wins: a submitted text cannot give a note another note's id.
      id: old ? idOf(old) : idOf(note),
      to: note.path,
      title: str(note.data, "title") ?? note.path,
      type: str(note.data, "type") ?? "",
      namespace: namespaceOf(root, note.path),
      hub: hubKindOf(root, note.path),
      status: str(note.data, "status") ?? "stable",
    };
    if (!old) {
      notes.push({
        ...common,
        kind: "created",
        from: null,
        typeBefore: null,
        namespaceBefore: null,
        statusBefore: null,
        versionBefore: null,
        humanVerified: false,
        textChanged: true,
        primary: true,
      });
      continue;
    }
    const moved = old.path !== note.path;
    const textChanged = old.text !== note.text;
    if (!moved && !textChanged) continue;
    notes.push({
      ...common,
      kind: moved ? "moved" : "updated",
      from: old.path,
      typeBefore: str(old.data, "type") ?? "",
      namespaceBefore: namespaceOf(root, old.path),
      statusBefore: str(old.data, "status") ?? "stable",
      versionBefore: str(old.data, "version") ?? null,
      humanVerified: trustTier(old.data.verified) === "human",
      textChanged,
      primary: primaryPaths.has(note.path) || primaryPaths.has(old.path),
    });
  }
  for (const old of deleted) {
    notes.push({
      id: idOf(old),
      kind: "deleted",
      from: old.path,
      to: null,
      title: str(old.data, "title") ?? old.path,
      type: str(old.data, "type") ?? "",
      typeBefore: str(old.data, "type") ?? "",
      namespace: null,
      namespaceBefore: namespaceOf(root, old.path),
      hub: hubKindOf(root, old.path),
      statusBefore: str(old.data, "status") ?? "stable",
      status: null,
      versionBefore: str(old.data, "version") ?? null,
      humanVerified: trustTier(old.data.verified) === "human",
      textChanged: true,
      primary: true,
    });
  }
  notes.sort((a, b) => ((a.to ?? a.from)! < (b.to ?? b.from)! ? -1 : 1));

  const oldTerms = vocabulary(before);
  const newTerms = vocabulary(after);
  const terms: TermChange[] = [];
  for (const [key, kind] of newTerms) {
    if (!oldTerms.has(key))
      terms.push({ kind, slug: key.slice(key.indexOf(":") + 1), change: "added" });
  }
  for (const [key, kind] of oldTerms) {
    if (!newTerms.has(key))
      terms.push({ kind, slug: key.slice(key.indexOf(":") + 1), change: "removed" });
  }
  terms.sort((a, b) => (a.kind + a.slug < b.kind + b.slug ? -1 : 1));

  const namespaces = new Set<string>();
  for (const n of notes) {
    // Side effects do not decide where a changeset is written: a move in admissions that
    // rewrites a link in a finance note is an admissions change.
    if (!n.primary && n.kind === "updated") continue;
    if (n.namespace) namespaces.add(n.namespace);
    if (n.namespaceBefore) namespaces.add(n.namespaceBefore);
  }
  const assets: string[] = [];
  for (const op of ops) {
    if (!isAsset(op.path)) continue;
    assets.push(op.path);
    const ns = namespaceOf(root, op.path);
    if (ns) namespaces.add(ns);
  }
  const touchesTaxonomy =
    terms.length > 0 ||
    ops.some((op) => op.path.startsWith(".kb/")) ||
    notes.some((n) => n.hub !== null && (n.primary || n.kind !== "updated"));

  return {
    notes,
    terms,
    namespaces: [...namespaces].sort(),
    touchesTaxonomy,
    assets: assets.sort(),
  };
}
