import { editFrontmatter, parseFrontmatter } from "../frontmatter.ts";
import { isoInstant, newId } from "../lifecycle.ts";
import { buildNoteText, strList } from "../note.ts";
import { fromBundlePath, hubPath } from "../paths.ts";
import { TAGS_PATH } from "../profile.ts";
import type { Actor, FileOp, TermKind } from "../types.ts";
import { fieldForKind, hasTerm, termLookup, type Vault } from "../vault.ts";
import { MEMBERS_END, MEMBERS_START } from "../hubs.ts";
import { appendLogEntry } from "./logmd.ts";
import { moveInWorkspace, redirectInbound } from "./notes.ts";
import { Workspace } from "./workspace.ts";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug))
    throw new Error(`"${slug}" is not a valid term; use lowercase kebab-case`);
}

/**
 * Edits `tags.yaml` in place: changed entries are rewritten on their own lines and every other
 * line, comment, and style is kept.
 */
function editTags(
  ws: Workspace,
  fn: (
    tags: Record<string, { description?: string; aliases?: string[] } | null>,
    set: Map<string, unknown>,
    unset: Set<string>,
  ) => void,
): void {
  const raw = ws.text(TAGS_PATH) ?? "";
  const parsed = parseFrontmatter(raw);
  if (parsed.errors.length)
    throw new Error(`${TAGS_PATH} does not parse: ${parsed.errors[0]!.message}`);
  const set = new Map<string, unknown>();
  const unset = new Set<string>();
  fn(
    parsed.data as Record<string, { description?: string; aliases?: string[] } | null>,
    set,
    unset,
  );
  ws.put(TAGS_PATH, editFrontmatter(raw, parsed.doc, set, unset));
}

function withAliases(
  entry: { description?: string; aliases?: string[] } | null | undefined,
  extra: string[],
) {
  const aliases = [...(entry?.aliases ?? [])];
  for (const a of extra) if (!aliases.includes(a)) aliases.push(a);
  return { ...(entry ?? {}), description: entry?.description ?? "", aliases };
}

function replaceInNotes(ws: Workspace, kind: TermKind, from: string[], into: string): void {
  const field = fieldForKind(kind);
  for (const path of ws.notePaths()) {
    const note = ws.note(path);
    if (!note) continue;
    const values = strList(note.data, field);
    if (!values.some((v) => from.includes(v))) continue;
    ws.update(path, (n) => {
      const next: string[] = [];
      for (const v of strList(n.data, field)) {
        const r = from.includes(v) ? into : v;
        if (!next.includes(r)) next.push(r);
      }
      n.data[field] = next;
    });
  }
}

function logTaxonomy(ws: Workspace, now: Date, entry: string): void {
  const path = fromBundlePath(ws.vault.root, "/log.md");
  ws.put(path, appendLogEntry(ws.text(path), "Vault log", isoInstant(now).slice(0, 10), entry));
}

/** Adds a tag to `tags.yaml`, or creates a Theme or System hub. */
export function addTerm(
  vault: Vault,
  kind: TermKind,
  slug: string,
  input: { title?: string; description?: string; aliases?: string[] },
  actor: Actor,
  now: Date,
): FileOp[] {
  assertSlug(slug);
  if (hasTerm(vault, kind, slug)) throw new Error(`The ${kind} "${slug}" already exists`);
  const ws = new Workspace(vault);
  if (kind === "tag") {
    editTags(ws, (_tags, set) => {
      set.set(slug, { description: input.description ?? "", aliases: input.aliases ?? [] });
    });
  } else {
    const path = hubPath(vault.root, kind, slug);
    const title = input.title ?? slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    const description = input.description ?? `Hub for ${title}.`;
    const data = {
      type: kind === "theme" ? "Theme" : "System",
      title,
      description,
      id: newId(vault.profile.id_prefix, now),
      version: "1.0.0",
      ...(input.aliases?.length ? { aliases: input.aliases } : {}),
      generated: { by: actor, at: isoInstant(now) },
    };
    const body = `# Overview\n\n${description}\n\n# Members\n\n${MEMBERS_START}\n\n_No notes yet._\n\n${MEMBERS_END}\n`;
    ws.put(path, buildNoteText(data, body));
  }
  logTaxonomy(ws, now, `Added ${kind} \`${slug}\` (${actor})`);
  return ws.ops();
}

/**
 * Adds another name for a term, so notes and searches that use it reach the canonical term.
 * The linter rewrites the alias to the term wherever it is used.
 */
export function addAlias(
  vault: Vault,
  kind: TermKind,
  slug: string,
  alias: string,
  now: Date = new Date(),
): FileOp[] {
  assertSlug(alias);
  if (!hasTerm(vault, kind, slug)) throw new Error(`Unknown ${kind} "${slug}"`);
  const taken = termLookup(vault, kind).get(alias);
  if (taken === slug) return [];
  if (taken !== undefined)
    throw new Error(
      hasTerm(vault, kind, alias)
        ? `"${alias}" is a ${kind} of its own; use merge`
        : `"${alias}" is already another name for "${taken}"`,
    );
  const ws = new Workspace(vault);
  if (kind === "tag") {
    editTags(ws, (tags, set) => {
      set.set(slug, withAliases(tags[slug], [alias]));
    });
  } else {
    ws.update(hubPath(vault.root, kind, slug), (n) => {
      n.data.aliases = [...strList(n.data, "aliases"), alias];
    });
  }
  logTaxonomy(ws, now, `Added \`${alias}\` as another name for ${kind} \`${slug}\``);
  return ws.ops();
}

/**
 * Renames a term everywhere in one set of ops: the vocabulary entry (or hub file), every note
 * that uses it, and inbound links to the hub. The old name becomes an alias.
 */
export function renameTerm(
  vault: Vault,
  kind: TermKind,
  from: string,
  to: string,
  now: Date = new Date(),
): FileOp[] {
  assertSlug(to);
  if (!hasTerm(vault, kind, from)) throw new Error(`Unknown ${kind} "${from}"`);
  if (hasTerm(vault, kind, to)) throw new Error(`The ${kind} "${to}" already exists; use merge`);
  const ws = new Workspace(vault);
  if (kind === "tag") {
    editTags(ws, (tags, set, unset) => {
      unset.add(from);
      set.set(to, withAliases(tags[from], [from]));
    });
  } else {
    const fromPath = hubPath(vault.root, kind, from);
    const toPath = hubPath(vault.root, kind, to);
    moveInWorkspace(ws, fromPath, toPath);
    ws.update(toPath, (n) => {
      const aliases = strList(n.data, "aliases");
      if (!aliases.includes(from)) n.data.aliases = [...aliases, from];
    });
  }
  replaceInNotes(ws, kind, [from], to);
  logTaxonomy(ws, now, `Renamed ${kind} \`${from}\` to \`${to}\``);
  return ws.ops();
}

/** Merges terms into one. The merged terms and their aliases become aliases of the target. */
export function mergeTerms(
  vault: Vault,
  kind: TermKind,
  from: string[],
  into: string,
  now: Date = new Date(),
): FileOp[] {
  if (!hasTerm(vault, kind, into)) throw new Error(`Unknown ${kind} "${into}"`);
  const sources = from.filter((f) => f !== into);
  for (const f of sources) if (!hasTerm(vault, kind, f)) throw new Error(`Unknown ${kind} "${f}"`);
  if (!sources.length) return [];
  const ws = new Workspace(vault);
  if (kind === "tag") {
    editTags(ws, (tags, set, unset) => {
      const aliases: string[] = [];
      for (const f of sources) {
        aliases.push(f, ...(tags[f]?.aliases ?? []));
        unset.add(f);
      }
      set.set(into, withAliases(tags[into], aliases));
    });
  } else {
    const hubs = kind === "theme" ? vault.themes : vault.systems;
    const intoPath = hubPath(vault.root, kind, into);
    const aliases: string[] = [];
    for (const f of sources) {
      const fromPath = hubPath(vault.root, kind, f);
      aliases.push(f, ...(hubs.get(f)?.aliases ?? []));
      redirectInbound(ws, fromPath, intoPath);
      ws.delete(fromPath);
    }
    ws.update(intoPath, (n) => {
      const current = strList(n.data, "aliases");
      n.data.aliases = [...current, ...aliases.filter((a) => !current.includes(a))];
    });
  }
  replaceInNotes(ws, kind, sources, into);
  logTaxonomy(
    ws,
    now,
    `Merged ${kind} ${sources.map((s) => `\`${s}\``).join(", ")} into \`${into}\``,
  );
  return ws.ops();
}
