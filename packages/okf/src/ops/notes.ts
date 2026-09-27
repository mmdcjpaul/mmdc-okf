import {
  addDays,
  bumpVersion,
  initialVersion,
  isoInstant,
  isValidVersion,
  newId,
  parseActor,
  verifications,
} from "../lifecycle.ts";
import { extractLinks, resolveLink } from "../links.ts";
import { buildNoteText, parseNote, str, type ParsedNote } from "../note.ts";
import {
  fromBundlePath,
  hubPath,
  makeHref,
  namespaceOf,
  normalizeNotePath,
  slugify,
  toBundlePath,
} from "../paths.ts";
import type { Actor, ChangeClass, FileOp } from "../types.ts";
import type { Vault } from "../vault.ts";
import { appendLogEntry } from "./logmd.ts";
import { templateBody, typeDefaults } from "./templates.ts";
import { Workspace } from "./workspace.ts";

export interface NewNoteInput {
  type: string;
  title: string;
  namespace: string;
  description?: string;
  themes?: string[];
  systems?: string[];
  tags?: string[];
  /** Subfolder inside the namespace, for tidiness only. */
  folder?: string;
  status?: "draft" | "stable";
  body?: string;
  /** Fixed id, for tests and imports. A fresh ULID otherwise. */
  id?: string;
  extra?: Record<string, unknown>;
}

function hubLinks(vault: Vault, from: string, themes: string[], systems: string[]): string[] {
  const out: string[] = [];
  for (const [kind, slugs] of [
    ["theme", themes],
    ["system", systems],
  ] as const) {
    for (const slug of slugs) {
      const hub = (kind === "theme" ? vault.themes : vault.systems).get(slug);
      const path = hub?.path ?? hubPath(vault.root, kind, slug);
      out.push(
        `[${hub?.title ?? slug}](${makeHref(vault.root, from, path, vault.profile.link_style)})`,
      );
    }
  }
  return out;
}

/** Creates a note from the type's template with a fresh id. Throws if the file exists. */
export function newNote(vault: Vault, input: NewNoteInput, actor: Actor, now: Date): FileOp[] {
  const slug = slugify(input.title);
  const folder = [vault.root, input.namespace, input.folder?.replace(/^\/+|\/+$/g, "")]
    .filter(Boolean)
    .join("/");
  const path = `${folder}/${slug}.md`;
  if (vault.notes.has(path)) throw new Error(`A note already exists at ${path}`);
  const themes = input.themes ?? [];
  const systems = input.systems ?? [];
  const owner = vault.namespaces[input.namespace]?.owner;
  const data: Record<string, unknown> = {
    type: input.type,
    title: input.title,
    description: input.description ?? "TODO: one sentence that says what this note covers.",
    id: input.id ?? newId(vault.profile.id_prefix, now),
    version: initialVersion(input.status),
    themes,
    ...(systems.length ? { systems } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(input.status ? { status: input.status } : {}),
    generated: { by: actor, at: isoInstant(now) },
    ...typeDefaults(input.type, { namespace: input.namespace, slug, ...(owner ? { owner } : {}) }),
    ...input.extra,
  };
  const body = input.body ?? templateBody(input.type, hubLinks(vault, path, themes, systems));
  return [{ op: "put", path, content: buildNoteText(data, body) }];
}

/** Rewrites links in `note` whose target is `from` so they point at `to`, keeping each link's style. */
function retarget(
  vault: Vault,
  note: ParsedNote,
  from: string,
  to: string,
  notePathAfter = note.path,
): string {
  const edits: { start: number; end: number; text: string }[] = [];
  for (const link of extractLinks(note)) {
    if (link.kind === "wikilink") continue;
    const r = resolveLink(vault, note.path, link.href);
    if (r.external || r.path !== from) continue;
    const style = link.href.startsWith("/") ? "absolute" : "relative";
    edits.push({
      start: link.hrefStart,
      end: link.hrefEnd,
      text: makeHref(vault.root, notePathAfter, to, style, r.anchor),
    });
  }
  edits.sort((a, b) => b.start - a.start);
  let text = note.text;
  for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

const PATH_FIELDS = ["superseded_by", "self_service", "runbook"];

/**
 * Moves a note in the workspace and rewrites every inbound link, relative links inside the
 * moved note, and path fields (`superseded_by`, `self_service`, `runbook`, `sources`).
 * The note keeps its id.
 */
export function moveInWorkspace(ws: Workspace, fromPath: string, toPath: string): void {
  const { vault } = ws;
  const moving = vault.notes.get(fromPath);
  if (!moving) throw new Error(`No note at ${fromPath}`);
  if (ws.has(toPath)) throw new Error(`A note already exists at ${toPath}`);

  // Relative links inside the moved note are recomputed from its new folder.
  const edits: { start: number; end: number; text: string }[] = [];
  for (const link of extractLinks(moving)) {
    if (link.kind === "wikilink" || link.href.startsWith("/") || link.href.startsWith("#"))
      continue;
    const r = resolveLink(vault, fromPath, link.href);
    if (r.external || !r.path) continue;
    const target = r.path === fromPath ? toPath : r.path;
    edits.push({
      start: link.hrefStart,
      end: link.hrefEnd,
      text: makeHref(vault.root, toPath, target, "relative", r.anchor),
    });
  }
  edits.sort((a, b) => b.start - a.start);
  let movedText = moving.text;
  for (const e of edits) movedText = movedText.slice(0, e.start) + e.text + movedText.slice(e.end);
  ws.delete(fromPath);
  ws.put(toPath, movedText);
  // Absolute self-links in the moved note.
  const movedNote = ws.note(toPath)!;
  const selfFixed = retarget(vault, { ...movedNote, path: fromPath }, fromPath, toPath, toPath);
  if (selfFixed !== movedText) ws.put(toPath, selfFixed);
  redirectInbound(ws, fromPath, toPath);
}

/** Points every link and path field that targets `fromPath` at `toPath` instead. */
export function redirectInbound(ws: Workspace, fromPath: string, toPath: string): void {
  const { vault } = ws;
  const oldBundle = toBundlePath(vault.root, fromPath);
  const newBundle = toBundlePath(vault.root, toPath);
  for (const path of [
    ...vault.notes.keys(),
    ...vault.reserved.filter((p) => p.endsWith("/log.md") || p === "log.md"),
  ]) {
    if (path === fromPath) continue;
    const current = path.endsWith(".md") && vault.notes.has(path) ? ws.note(path) : null;
    if (current) {
      const text = retarget(vault, current, fromPath, toPath);
      if (text !== current.text) ws.put(path, text);
      ws.update(path, (note) => {
        for (const key of PATH_FIELDS) {
          const v = str(note.data, key);
          if (v && resolveLink(vault, path, v).path === fromPath)
            note.data[key] = v.startsWith("/")
              ? newBundle
              : makeHref(vault.root, path, toPath, "relative");
        }
        if (Array.isArray(note.data.sources)) {
          note.data.sources = (note.data.sources as Record<string, unknown>[]).map((s) =>
            s && s.resource === oldBundle ? { ...s, resource: newBundle } : s,
          );
        }
      });
    } else {
      const text = ws.text(path);
      if (text) {
        const next = retarget(vault, parseNote(text, path), fromPath, toPath);
        if (next !== text) ws.put(path, next);
      }
    }
  }
}

/** Moves or renames a note. Every inbound link is rewritten in the same set of ops. */
export function moveNote(vault: Vault, from: string, to: string): FileOp[] {
  const ws = new Workspace(vault);
  moveInWorkspace(ws, normalizeNotePath(vault.root, from), normalizeNotePath(vault.root, to));
  return ws.ops();
}

function namespaceLogPath(vault: Vault, notePath: string): { path: string; heading: string } {
  const ns = namespaceOf(vault.root, notePath);
  if (!ns) return { path: fromBundlePath(vault.root, "/log.md"), heading: "Vault log" };
  return {
    path: fromBundlePath(vault.root, `/${ns}/log.md`),
    heading: `${vault.namespaces[ns]?.title ?? ns} log`,
  };
}

const CLASS_LABEL: Record<ChangeClass, string> = {
  fix: "Fix",
  addition: "Addition",
  process: "Process change",
};

/**
 * Bumps a note's version by change class. Additions and process changes update `generated`.
 * A process change also resets `verified` (earlier confirmations were about different
 * content), clears `stale_after`, and appends an entry to the namespace `log.md`.
 */
export function bump(
  vault: Vault,
  path: string,
  cls: ChangeClass,
  actor: Actor,
  now: Date,
  opts: { summary?: string } = {},
): FileOp[] {
  const repoPath = normalizeNotePath(vault.root, path);
  const note = vault.notes.get(repoPath);
  if (!note) throw new Error(`No note at ${repoPath}`);
  const current = str(note.data, "version");
  if (!isValidVersion(current)) throw new Error(`${repoPath} has no valid version to bump`);
  const next = bumpVersion(current, cls);
  const ws = new Workspace(vault);
  ws.update(repoPath, (n) => {
    n.data.version = next;
    if (cls !== "fix") n.data.generated = { by: actor, at: isoInstant(now) };
    if (cls === "process") {
      delete n.data.verified;
      delete n.data.stale_after;
    }
  });
  if (cls === "process") {
    const log = namespaceLogPath(vault, repoPath);
    const title = str(note.data, "title") ?? repoPath;
    const href = makeHref(vault.root, log.path, repoPath, vault.profile.link_style);
    const entry = `${CLASS_LABEL[cls]}: [${title}](${href}) ${current} to ${next} by ${actor}${opts.summary ? `. ${opts.summary}` : ""}`;
    ws.put(
      log.path,
      appendLogEntry(ws.text(log.path), log.heading, isoInstant(now).slice(0, 10), entry),
    );
  }
  return ws.ops();
}

/** Adds a human verification and sets `stale_after` from the type's review interval. */
export function verify(vault: Vault, path: string, actor: Actor, now: Date): FileOp[] {
  if (parseActor(actor)?.kind !== "human")
    throw new Error(`Only people can verify notes; actor "${actor}" is not human:<id>`);
  const repoPath = normalizeNotePath(vault.root, path);
  const note = vault.notes.get(repoPath);
  if (!note) throw new Error(`No note at ${repoPath}`);
  const reviewDays = vault.profile.types[str(note.data, "type") ?? ""]?.review_days;
  const ws = new Workspace(vault);
  ws.update(repoPath, (n) => {
    n.data.verified = [...verifications(n.data.verified), { by: actor, at: isoInstant(now) }];
    if (reviewDays) n.data.stale_after = isoInstant(addDays(now, reviewDays));
    else delete n.data.stale_after;
  });
  return ws.ops();
}
