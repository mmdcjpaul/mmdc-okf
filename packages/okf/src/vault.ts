import { parseNote, str, strList, type ParsedNote } from "./note.ts";
import { hubKindOf, isManagedPath, isMarkdown, isReserved, namespaceOf, slugOf } from "./paths.ts";
import {
  loadConfig,
  NAMESPACES_PATH,
  PROFILE_PATH,
  TAGS_PATH,
  type Namespace,
  type Profile,
  type Tag,
} from "./profile.ts";
import { readText, type FileSource } from "./source.ts";
import type { Issue, TermKind } from "./types.ts";

/** A Theme or System hub note. Its file name is the vocabulary slug. */
export interface Hub {
  slug: string;
  path: string;
  title: string;
  description: string;
  aliases: string[];
}

export interface Vault {
  src: FileSource;
  /** The bundle root folder, `kb` by default. */
  root: string;
  profile: Profile;
  namespaces: Record<string, Namespace>;
  tags: Record<string, Tag>;
  /** Problems loading `.kb/` configuration. */
  configIssues: Issue[];
  /** Every file under the bundle root. */
  files: string[];
  /** Every non-reserved markdown file under the bundle root, keyed by repository path. */
  notes: Map<string, ParsedNote>;
  /** Reserved files (`index.md`, `log.md`) under the bundle root. */
  reserved: string[];
  /** Text of reserved files and `.kb/*.yaml`, for operations that edit them. */
  aux: Map<string, string>;
  /** Note paths by id. More than one path means a duplicate id. */
  byId: Map<string, string[]>;
  themes: Map<string, Hub>;
  systems: Map<string, Hub>;
}

export interface LoadOptions {
  /** Parse only these notes (plus hubs). Vault-wide checks then see a partial vault. */
  only?: string[];
}

/** Loads the profile, vocabulary, and every note from a file source. */
export async function loadVault(src: FileSource, opts: LoadOptions = {}): Promise<Vault> {
  const config = await loadConfig(src);
  const root = config.profile.bundle_root.replace(/\/+$/, "");
  const files = await src.list(root ? root + "/" : "");
  const only = opts.only ? new Set(opts.only) : null;
  const notes = new Map<string, ParsedNote>();
  const reserved: string[] = [];
  const mdFiles = files.filter(isMarkdown);
  const aux = new Map<string, string>();
  const texts = await Promise.all(
    mdFiles.map(async (path) => {
      if (isReserved(path)) {
        const text = await readText(src, path);
        if (text !== null) aux.set(path, text);
        return null;
      }
      if (only && !only.has(path) && !hubKindOf(root, path)) return null;
      return readText(src, path);
    }),
  );
  mdFiles.forEach((path, i) => {
    if (isReserved(path)) {
      reserved.push(path);
      return;
    }
    const text = texts[i];
    if (text != null) notes.set(path, parseNote(text, path));
  });

  for (const path of [PROFILE_PATH, NAMESPACES_PATH, TAGS_PATH]) {
    const text = await readText(src, path);
    if (text !== null) aux.set(path, text);
  }

  const vault: Vault = {
    src,
    root,
    profile: config.profile,
    namespaces: config.namespaces,
    tags: config.tags,
    configIssues: config.issues,
    files,
    notes,
    reserved,
    aux,
    byId: new Map(),
    themes: new Map(),
    systems: new Map(),
  };
  indexVault(vault);
  return vault;
}

/** Rebuilds the id and hub lookups after notes change. */
export function indexVault(vault: Vault): void {
  vault.byId.clear();
  vault.themes.clear();
  vault.systems.clear();
  for (const [path, note] of vault.notes) {
    const id = str(note.data, "id");
    if (id) vault.byId.set(id, [...(vault.byId.get(id) ?? []), path]);
    const kind = hubKindOf(vault.root, path);
    if (kind) {
      const hub: Hub = {
        slug: slugOf(path),
        path,
        title: str(note.data, "title") ?? slugOf(path),
        description: str(note.data, "description") ?? "",
        aliases: strList(note.data, "aliases"),
      };
      (kind === "theme" ? vault.themes : vault.systems).set(hub.slug, hub);
    }
  }
}

/** Notes that are ordinary content: everything except files in `_meta/` and `_assets/`. */
export function contentNotes(vault: Vault): ParsedNote[] {
  return [...vault.notes.values()].filter((n) => !isManagedPath(vault.root, n.path));
}

export function noteNamespace(vault: Vault, note: ParsedNote): string | null {
  return namespaceOf(vault.root, note.path);
}

export function findNoteById(vault: Vault, id: string): ParsedNote | undefined {
  const path = vault.byId.get(id)?.[0];
  return path ? vault.notes.get(path) : undefined;
}

/** Maps every alias (and each canonical term) to its canonical term for one vocabulary kind. */
export function termLookup(vault: Vault, kind: TermKind): Map<string, string> {
  const map = new Map<string, string>();
  if (kind === "tag") {
    for (const [slug, tag] of Object.entries(vault.tags)) {
      for (const alias of tag.aliases) map.set(alias.toLowerCase(), slug);
    }
    for (const slug of Object.keys(vault.tags)) map.set(slug.toLowerCase(), slug);
  } else {
    const hubs = kind === "theme" ? vault.themes : vault.systems;
    for (const hub of hubs.values())
      for (const alias of hub.aliases) map.set(alias.toLowerCase(), hub.slug);
    for (const slug of hubs.keys()) map.set(slug.toLowerCase(), slug);
  }
  return map;
}

export function hasTerm(vault: Vault, kind: TermKind, slug: string): boolean {
  if (kind === "tag") return Object.hasOwn(vault.tags, slug);
  return (kind === "theme" ? vault.themes : vault.systems).has(slug);
}

export function fieldForKind(kind: TermKind): "themes" | "systems" | "tags" {
  return kind === "theme" ? "themes" : kind === "system" ? "systems" : "tags";
}
