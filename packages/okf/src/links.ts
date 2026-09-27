import type { Nodes, Root } from "mdast";
import { visit } from "unist-util-visit";
import { noteAst, str, strList, type ParsedNote } from "./note.ts";
import {
  dirname,
  fromBundlePath,
  isManagedPath,
  isMarkdown,
  isReserved,
  makeHref,
  normalizePath,
  slugify,
  slugOf,
  toBundlePath,
} from "./paths.ts";
import type { Vault } from "./vault.ts";

export interface Link {
  kind: "link" | "image" | "definition" | "wikilink";
  /** The href exactly as written, or the target of a wikilink. */
  href: string;
  /** Link text, image alt text, or the wikilink label. */
  text: string;
  line: number;
  column: number;
  /** Offsets of the href in the note text, for rewriting. Wikilinks use the whole `[[...]]` span. */
  hrefStart: number;
  hrefEnd: number;
  /** Offsets of the whole link in the note text. */
  start: number;
  end: number;
}

export interface ResolvedLink {
  href: string;
  /** Repository path of the target, or null for external links. */
  path: string | null;
  anchor?: string;
  targetId: string | null;
  /** True when the target exists (a note, a reserved file, a folder, or an asset). */
  exists: boolean;
  /** True for an internal markdown link whose target does not exist: knowledge not yet written. */
  wanted: boolean;
  external: boolean;
  /** True when the target is outside the bundle root. */
  outside: boolean;
}

export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

function scanHref(text: string, from: number, limit: number): [number, number] | null {
  let i = from;
  while (i < limit && (text[i] === " " || text[i] === "\t" || text[i] === "\n")) i++;
  if (i >= limit) return null;
  if (text[i] === "<") {
    const close = text.indexOf(">", i + 1);
    return close < 0 || close > limit ? null : [i + 1, close];
  }
  let depth = 0;
  let j = i;
  for (; j < limit; j++) {
    const c = text[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n") break;
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    }
  }
  return j > i ? [i, j] : null;
}

const WIKILINK_RE = /\[\[([^\]\n|#]+)(#[^\]\n|]*)?(?:\|([^\]\n]+))?\]\]/g;

function nodeText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(nodeText).join("");
  if (node.type === "image") return node.alt ?? "";
  return "";
}

/** Extracts links, images, reference definitions, and wikilinks from a note, ignoring code. */
export function extractLinks(note: ParsedNote, ast: Root = noteAst(note)): Link[] {
  const text = note.text;
  const links: Link[] = [];
  visit(ast, (node) => {
    const pos = node.position;
    if (!pos || pos.start.offset === undefined || pos.end.offset === undefined) return;
    const start = pos.start.offset;
    const end = pos.end.offset;
    if (node.type === "link" || node.type === "image") {
      const slice = text.slice(start, end);
      const idx = slice.lastIndexOf("](");
      if (idx < 0) return;
      const span = scanHref(text, start + idx + 2, end);
      if (!span) return;
      links.push({
        kind: node.type,
        href: text.slice(span[0], span[1]),
        text: nodeText(node),
        line: pos.start.line,
        column: pos.start.column,
        hrefStart: span[0],
        hrefEnd: span[1],
        start,
        end,
      });
    } else if (node.type === "definition") {
      const slice = text.slice(start, end);
      const idx = slice.indexOf("]:");
      if (idx < 0) return;
      const span = scanHref(text, start + idx + 2, end);
      if (!span) return;
      links.push({
        kind: "definition",
        href: text.slice(span[0], span[1]),
        text: node.label ?? node.identifier,
        line: pos.start.line,
        column: pos.start.column,
        hrefStart: span[0],
        hrefEnd: span[1],
        start,
        end,
      });
    } else if (node.type === "text") {
      const slice = text.slice(start, end);
      if (!slice.includes("[[")) return;
      for (const m of slice.matchAll(WIKILINK_RE)) {
        const s = start + m.index;
        const before = text.slice(0, s);
        const line = before.split("\n").length;
        links.push({
          kind: "wikilink",
          href: m[1]!.trim() + (m[2] ?? ""),
          text: (m[3] ?? m[1]!).trim(),
          line,
          column: s - before.lastIndexOf("\n"),
          hrefStart: s,
          hrefEnd: s + m[0].length,
          start: s,
          end: s + m[0].length,
        });
      }
    }
  });
  return links.sort((a, b) => a.start - b.start);
}

const fileSets = new WeakMap<Vault, { files: string[]; set: Set<string>; dirs: Set<string> }>();

function fileSet(vault: Vault): { set: Set<string>; dirs: Set<string> } {
  let cached = fileSets.get(vault);
  if (!cached || cached.files !== vault.files) {
    const set = new Set(vault.files);
    for (const p of vault.notes.keys()) set.add(p);
    const dirs = new Set<string>();
    for (const p of set) {
      let d = dirname(p);
      while (d && !dirs.has(d)) {
        dirs.add(d);
        d = dirname(d);
      }
    }
    cached = { files: vault.files, set, dirs };
    fileSets.set(vault, cached);
  }
  return cached;
}

/** Resolves an href written in `from` to a repository path and, for notes, an id. */
export function resolveLink(vault: Vault, from: string, href: string): ResolvedLink {
  const base: ResolvedLink = {
    href,
    path: null,
    targetId: null,
    exists: false,
    wanted: false,
    external: false,
    outside: false,
  };
  if (isExternalHref(href)) return { ...base, external: true, exists: true };
  const hash = href.indexOf("#");
  const anchor = hash >= 0 ? href.slice(hash + 1) : undefined;
  let pathPart = hash >= 0 ? href.slice(0, hash) : href;
  const q = pathPart.indexOf("?");
  if (q >= 0) pathPart = pathPart.slice(0, q);
  if (pathPart === "") {
    return {
      ...base,
      path: from,
      ...(anchor !== undefined ? { anchor } : {}),
      exists: true,
      targetId: str(vault.notes.get(from)?.data ?? {}, "id") ?? null,
    };
  }
  try {
    pathPart = decodeURIComponent(pathPart);
  } catch {
    // keep as written
  }
  let path = pathPart.startsWith("/")
    ? normalizePath(fromBundlePath(vault.root, pathPart))
    : normalizePath(`${dirname(from)}/${pathPart}`);
  const outside = vault.root !== "" && !(path === vault.root || path.startsWith(vault.root + "/"));
  const { set, dirs } = fileSet(vault);
  if (pathPart.endsWith("/") || dirs.has(path)) path = `${path.replace(/\/$/, "")}/index.md`;
  let exists = set.has(path);
  if (!exists && path.endsWith("/index.md")) exists = dirs.has(dirname(path));
  const note = vault.notes.get(path);
  return {
    ...base,
    path,
    ...(anchor !== undefined ? { anchor } : {}),
    targetId: note ? (str(note.data, "id") ?? null) : null,
    exists,
    // Generated files (index.md, log.md, _meta/) appear after `kb index`; they are never wanted notes.
    wanted:
      !exists &&
      !outside &&
      isMarkdown(path) &&
      !isReserved(path) &&
      !isManagedPath(vault.root, path),
    outside,
  };
}

const titleIndexes = new WeakMap<Vault, Map<string, string>>();

/** Finds the note a wikilink target refers to, by title, alias, file name, or path. */
export function resolveWikilink(vault: Vault, target: string): string | null {
  let index = titleIndexes.get(vault);
  if (!index) {
    index = new Map();
    const add = (key: string, path: string) => {
      const k = key.trim().toLowerCase();
      if (k && !index!.has(k)) index!.set(k, path);
    };
    const notes = [...vault.notes.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
    for (const n of notes) add(str(n.data, "title") ?? "", n.path);
    for (const n of notes) for (const a of strList(n.data, "aliases")) add(a, n.path);
    for (const n of notes) {
      add(slugOf(n.path), n.path);
      add(toBundlePath(vault.root, n.path).slice(1).replace(/\.md$/i, ""), n.path);
    }
    titleIndexes.set(vault, index);
  }
  const clean = target
    .replace(/#.*$/, "")
    .replace(/\.md$/i, "")
    .replace(/^\/+/, "")
    .trim()
    .toLowerCase();
  return index.get(clean) ?? null;
}

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Applies non-overlapping edits to a string. */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  let last = Infinity;
  for (const e of sorted) {
    if (e.end > last) continue;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    last = e.start;
  }
  return out;
}

/** Rewrites Obsidian wikilinks as standard markdown links in the profile's link style. */
export function convertWikilinks(vault: Vault, note: ParsedNote): string {
  const edits: TextEdit[] = [];
  for (const link of extractLinks(note)) {
    if (link.kind !== "wikilink") continue;
    const hash = link.href.indexOf("#");
    const target = hash >= 0 ? link.href.slice(0, hash) : link.href;
    const anchor = hash >= 0 ? slugify(link.href.slice(hash + 1)) : undefined;
    const resolved = resolveWikilink(vault, target);
    const to = resolved ?? `${dirname(note.path)}/${slugify(target)}.md`;
    const href = makeHref(vault.root, note.path, to, vault.profile.link_style, anchor);
    const label = link.text.replace(/[[\]]/g, "");
    edits.push({ start: link.start, end: link.end, text: `[${label}](${href})` });
  }
  return applyTextEdits(note.text, edits);
}

/** Rewrites internal hrefs in a note. `fn` returns the new href, or null to leave a link alone. */
export function rewriteLinks(
  vault: Vault,
  note: ParsedNote,
  fn: (link: Link, resolved: ResolvedLink) => string | null,
): string {
  const edits: TextEdit[] = [];
  for (const link of extractLinks(note)) {
    if (link.kind === "wikilink") continue;
    const resolved = resolveLink(vault, note.path, link.href);
    if (resolved.external) continue;
    const next = fn(link, resolved);
    if (next !== null && next !== link.href)
      edits.push({ start: link.hrefStart, end: link.hrefEnd, text: next });
  }
  return applyTextEdits(note.text, edits);
}

/** Internal note links (not images or external URLs) with their resolution. */
export function noteLinks(
  vault: Vault,
  note: ParsedNote,
): { link: Link; resolved: ResolvedLink }[] {
  return extractLinks(note)
    .filter((l) => l.kind === "link" || l.kind === "definition")
    .map((link) => ({ link, resolved: resolveLink(vault, note.path, link.href) }))
    .filter((x) => !x.resolved.external && x.resolved.path !== null && isMarkdown(x.resolved.path));
}
