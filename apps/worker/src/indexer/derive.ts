/**
 * Pure part of the index job: turns a loaded vault into Postgres rows and search documents.
 * No I/O here, so incremental and full runs derive exactly the same rows from the same tree.
 */
import { createHash } from "node:crypto";
import type { LinkInput, NewNoteRow, TermRow, NamespaceRow, AssetRow } from "@lore/db";
import {
  countWords,
  extractLinks,
  hubKindOf,
  isStale,
  MEMBERS_END,
  MEMBERS_START,
  namespaceOf,
  parseNote,
  resolveLink,
  str,
  strList,
  trustTier,
  type ParsedNote,
  type Vault,
} from "@lore/okf";
import type { NoteDoc } from "@lore/search";

export interface DerivedNote {
  row: NewNoteRow & { rowHash: string };
  links: LinkInput[];
  /** Text embedded as the note's card vector: title, description, and aliases. */
  cardText: string;
  note: ParsedNote;
  desk: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function isManaged(root: string, path: string): boolean {
  const rel = root ? path.slice(root.length + 1) : path;
  return rel.split("/").some((s) => s === "_meta" || s === "_assets");
}

/** The body without the generated hub member list, which can name notes the reader cannot see. */
export function stripMembers(body: string): string {
  const start = body.indexOf(MEMBERS_START);
  const end = body.indexOf(MEMBERS_END);
  if (start < 0 || end < start) return body;
  const before = body.slice(0, start).replace(/\n#+\s*Members\s*\n+$/i, "\n");
  return (
    (before + body.slice(end + MEMBERS_END.length)).replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
  );
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function noteSlug(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.md$/i, "");
}

/** Health score from PRD 7.7 and plans/02-library.md L7; feedback terms join in L7. */
export function healthScore(input: { stale: boolean; trust: string; brokenLinks: number }): number {
  let score = 100;
  if (input.stale) score -= 20;
  if (input.trust === "unverified") score -= 10;
  score -= 5 * input.brokenLinks;
  return Math.max(0, Math.min(100, score));
}

export interface DeriveResult {
  notes: DerivedNote[];
  /** Ids used by more than one file. The first path in sort order wins. */
  duplicateIds: { id: string; paths: string[] }[];
}

export function deriveNotes(
  vault: Vault,
  blobShaOf: (path: string) => string,
  now: Date,
): DeriveResult {
  const root = vault.root;
  const out: DerivedNote[] = [];
  const seen = new Map<string, string[]>();
  const paths = [...vault.notes.keys()].sort();
  for (const path of paths) {
    if (isManaged(root, path)) continue;
    const note = vault.notes.get(path)!;
    const data = note.data;
    const id = str(data, "id") ?? fallbackId(path);
    seen.set(id, [...(seen.get(id) ?? []), path]);
    if (seen.get(id)!.length > 1) continue;

    const hubKind = hubKindOf(root, path);
    const namespace = hubKind ? null : namespaceOf(root, path);
    const rel = root ? path.slice(root.length + 1) : path;
    const segs = rel.split("/");
    const folder = namespace ? segs.slice(1, -1).join("/") : "";
    const type =
      str(data, "type") ??
      (hubKind === "theme" ? "Theme" : hubKind === "system" ? "System" : "Note");
    const title = str(data, "title") ?? noteSlug(path);
    const status = str(data, "status") ?? "stable";
    const trust = trustTier(data.verified);
    const stale = isStale(note, now);
    const body = hubKind ? stripMembers(note.body) : note.body;

    const members = hubKind ? memberRange(note) : null;
    const links: LinkInput[] = [];
    let broken = 0;
    for (const link of extractLinks(note)) {
      if (link.kind === "wikilink") continue;
      if (members && link.start >= members[0] && link.end <= members[1]) continue;
      const r = resolveLink(vault, path, link.href);
      if (r.external || !r.path) continue;
      const isImage = link.kind === "image" || r.path.includes("/_assets/");
      if (r.wanted) broken++;
      links.push({
        href: link.href,
        targetPath: r.path,
        targetId: r.targetId,
        kind: isImage ? "image" : "body",
        wanted: r.wanted,
        anchor: r.anchor ?? null,
        label: link.text,
      });
    }
    const supersededBy = str(data, "superseded_by");
    if (supersededBy) {
      const r = resolveLink(vault, path, supersededBy);
      if (r.path) {
        links.push({
          href: supersededBy,
          targetPath: r.path,
          targetId: r.targetId,
          kind: "supersedes",
          wanted: r.wanted,
          anchor: null,
          label: "",
        });
      }
    }
    links.sort((a, b) =>
      a.kind + a.href < b.kind + b.href ? -1 : a.kind + a.href > b.kind + b.href ? 1 : 0,
    );
    const dedup = links.filter(
      (l, i) => i === 0 || l.href !== links[i - 1]!.href || l.kind !== links[i - 1]!.kind,
    );

    const aliases = strList(data, "aliases");
    const staleAfter = toDate(data.stale_after);
    const row: Omit<NewNoteRow, "rowHash"> = {
      vaultId: "",
      id,
      path,
      slug: noteSlug(path),
      namespace,
      folder,
      hubKind,
      type,
      title,
      description: str(data, "description") ?? "",
      aliases,
      themes: strList(data, "themes"),
      systems: strList(data, "systems"),
      tags: strList(data, "tags"),
      frontmatter: data,
      body,
      version: str(data, "version") ?? null,
      status,
      trustTier: trust,
      staleAfter,
      owner: str(data, "owner") ?? null,
      supersededBy: supersededBy ?? null,
      contentHash: sha256(note.text),
      blobSha: blobShaOf(path),
      wordCount: countWords(note),
      healthScore: healthScore({ stale, trust, brokenLinks: broken }),
    };
    const rowHash = sha256(JSON.stringify([row, dedup]));
    out.push({
      row: { ...row, rowHash },
      links: dedup,
      cardText: [title, str(data, "description") ?? "", aliases.join(", ")]
        .filter(Boolean)
        .join("\n"),
      note,
      desk: vault.profile.types[type]?.desk ?? "answer",
    });
  }
  const duplicateIds = [...seen]
    .filter(([, p]) => p.length > 1)
    .map(([id, p]) => ({ id, paths: p }));
  return { notes: out, duplicateIds };
}

function memberRange(note: ParsedNote): [number, number] | null {
  const start = note.text.indexOf(MEMBERS_START);
  const end = note.text.indexOf(MEMBERS_END);
  return start >= 0 && end > start ? [start, end + MEMBERS_END.length] : null;
}

export function deriveNamespaces(vault: Vault, folders: string[]): Omit<NamespaceRow, "vaultId">[] {
  const rows = new Map<string, Omit<NamespaceRow, "vaultId">>();
  for (const [slug, ns] of Object.entries(vault.namespaces)) {
    rows.set(slug, {
      slug,
      title: ns.title,
      description: ns.description,
      visibility: ns.visibility,
      publishing: ns.publishing,
      aiProcessing: ns.ai_processing,
      ownerTeam: ns.owner ?? null,
    });
  }
  // A folder with notes but no entry in namespaces.yaml is still a namespace (lint flags it).
  for (const slug of folders) {
    if (!rows.has(slug)) {
      rows.set(slug, {
        slug,
        title: slug,
        description: "",
        visibility: "company",
        publishing: "manual",
        aiProcessing: true,
        ownerTeam: null,
      });
    }
  }
  return [...rows.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

export function deriveTerms(
  vault: Vault,
  idOfPath: Map<string, string>,
): Omit<TermRow, "vaultId">[] {
  const rows: Omit<TermRow, "vaultId">[] = [];
  for (const [kind, hubs] of [
    ["theme", vault.themes],
    ["system", vault.systems],
  ] as const) {
    for (const hub of hubs.values()) {
      rows.push({
        kind,
        slug: hub.slug,
        title: hub.title,
        description: hub.description,
        aliases: hub.aliases,
        facet: null,
        state: "active",
        hubNoteId: idOfPath.get(hub.path) ?? null,
      });
    }
  }
  for (const [slug, tag] of Object.entries(vault.tags)) {
    rows.push({
      kind: "tag",
      slug,
      title: slug,
      description: tag.description,
      aliases: tag.aliases,
      facet: tag.facet ?? null,
      state: "active",
      hubNoteId: null,
    });
  }
  return rows.sort((a, b) => (a.kind + a.slug < b.kind + b.slug ? -1 : 1));
}

/** Search synonyms from tag and hub aliases, in both directions. */
export function deriveSynonyms(vault: Vault): Record<string, string[]> {
  const syn: Record<string, Set<string>> = {};
  const pair = (a: string, b: string) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (x === y) return;
    (syn[x] ??= new Set()).add(y);
    (syn[y] ??= new Set()).add(x);
  };
  for (const hub of [...vault.themes.values(), ...vault.systems.values()]) {
    for (const a of hub.aliases) pair(a, hub.title);
  }
  for (const [slug, tag] of Object.entries(vault.tags)) for (const a of tag.aliases) pair(a, slug);
  return Object.fromEntries(Object.entries(syn).map(([k, v]) => [k, [...v].sort()]));
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export function deriveAssets(
  root: string,
  tree: Iterable<{ path: string; blobSha: string; size: number }>,
): Omit<AssetRow, "vaultId">[] {
  const out: Omit<AssetRow, "vaultId">[] = [];
  for (const e of tree) {
    if (!e.path.startsWith(root + "/") || !e.path.includes("/_assets/")) continue;
    const ext = e.path.slice(e.path.lastIndexOf(".") + 1).toLowerCase();
    const segs = e.path.slice(root.length + 1).split("/");
    const ns = segs[0]!.startsWith("_") ? null : segs[0]!;
    out.push({
      path: e.path,
      namespace: ns,
      blobSha: e.blobSha,
      mime: MIME[ext] ?? "application/octet-stream",
      size: e.size,
    });
  }
  return out;
}

export function noteDoc(d: DerivedNote, vector: number[] | null, now: Date): NoteDoc {
  const r = d.row;
  return {
    id: r.id,
    path: r.path,
    slug: r.slug,
    title: r.title,
    aliases: r.aliases ?? [],
    description: r.description ?? "",
    body: (r.body ?? "").slice(0, 20_000),
    type: r.type,
    namespace: r.namespace ?? null,
    is_hub: r.hubKind != null,
    themes: r.themes ?? [],
    systems: r.systems ?? [],
    tags: r.tags ?? [],
    trust_tier: r.trustTier,
    status: r.status ?? "stable",
    stale: r.staleAfter ? r.staleAfter.getTime() <= now.getTime() : false,
    desk: d.desk,
    health: r.healthScore ?? 100,
    updated_at: 0,
    _vectors: { default: vector },
  };
}

/** Id for a note whose frontmatter has none (or cannot be parsed): stable per path. */
export function fallbackId(path: string): string {
  return `path_${sha256(path).slice(0, 26)}`;
}

/**
 * The id a revision of a note carries, parsed the same way as the full note, so history maps
 * to exactly the ids the index uses.
 */
export function idOfRevision(text: string, path: string): string {
  return str(parseNote(text, path).data, "id") ?? fallbackId(path);
}

/** Reads `version:` from a note's frontmatter without a full parse. */
export function versionOf(text: string): string | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  const fm = end > 0 ? text.slice(0, end) : text;
  const m = /^version:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)/m.exec(fm);
  return m ? m[1]! : null;
}

/** Change class implied by a version change: major is a Process change. */
export function classFromVersions(
  from: string | null,
  to: string | null,
): "fix" | "addition" | "process" | null {
  if (!to) return null;
  if (!from) return "addition";
  const [a, b] = [from, to].map((v) => v.split(".").map(Number)) as [number[], number[]];
  if (b[0]! > a[0]!) return "process";
  if (b[1]! > a[1]!) return "addition";
  if (b[2]! > a[2]!) return "fix";
  return null;
}
