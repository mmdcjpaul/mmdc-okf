/**
 * Read side of the Library. Every function that returns notes takes a {@link ReadScope} and
 * filters by it in SQL, so there is no read helper that skips the namespace check.
 */
import { and, asc, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  assets,
  commits,
  namespaces,
  noteCommits,
  noteLinks,
  notes,
  settings,
  taxonomyTerms,
  vaults,
  type AssetRow,
  type NamespaceRow,
  type NoteRow,
  type TermRow,
  type Vault,
} from "../schema.ts";

/** What one person may read in one vault. Built by `@lore/auth` from grants. */
export interface ReadScope {
  vaultId: string;
  /** Readable namespaces. Hubs (namespace null) are readable by every member. */
  namespaces: string[];
}

function readable(scope: ReadScope): SQL {
  const inVault = eq(notes.vaultId, scope.vaultId);
  const ns = scope.namespaces.length
    ? or(inArray(notes.namespace, scope.namespaces), isNull(notes.namespace))!
    : isNull(notes.namespace);
  return and(inVault, ns)!;
}

// Vaults and namespaces.

export async function getVaultBySlug(db: Db, slug: string): Promise<Vault | null> {
  const [row] = await db.select().from(vaults).where(eq(vaults.slug, slug));
  return row ?? null;
}

export async function firstVault(db: Db): Promise<Vault | null> {
  const [row] = await db.select().from(vaults).orderBy(asc(vaults.createdAt)).limit(1);
  return row ?? null;
}

export async function listNamespaces(db: Db, vaultId: string): Promise<NamespaceRow[]> {
  return db
    .select()
    .from(namespaces)
    .where(eq(namespaces.vaultId, vaultId))
    .orderBy(asc(namespaces.title));
}

export async function listTerms(
  db: Db,
  vaultId: string,
  kind?: TermRow["kind"],
): Promise<TermRow[]> {
  return db
    .select()
    .from(taxonomyTerms)
    .where(and(eq(taxonomyTerms.vaultId, vaultId), kind ? eq(taxonomyTerms.kind, kind) : undefined))
    .orderBy(asc(taxonomyTerms.title));
}

export async function getTerm(
  db: Db,
  vaultId: string,
  kind: TermRow["kind"],
  slug: string,
): Promise<TermRow | null> {
  const [row] = await db
    .select()
    .from(taxonomyTerms)
    .where(
      and(
        eq(taxonomyTerms.vaultId, vaultId),
        eq(taxonomyTerms.kind, kind),
        eq(taxonomyTerms.slug, slug),
      ),
    );
  return row ?? null;
}

// Notes.

/** Note fields for lists and cards: everything except the body and raw frontmatter. */
export const cardColumns = {
  id: notes.id,
  path: notes.path,
  slug: notes.slug,
  namespace: notes.namespace,
  folder: notes.folder,
  hubKind: notes.hubKind,
  type: notes.type,
  title: notes.title,
  description: notes.description,
  themes: notes.themes,
  systems: notes.systems,
  tags: notes.tags,
  version: notes.version,
  status: notes.status,
  trustTier: notes.trustTier,
  staleAfter: notes.staleAfter,
  owner: notes.owner,
  wordCount: notes.wordCount,
  healthScore: notes.healthScore,
  lastChangedAt: notes.lastChangedAt,
  lastChangedBy: notes.lastChangedBy,
  processChangedAt: notes.processChangedAt,
};

export type NoteCard = Pick<NoteRow, keyof typeof cardColumns>;

export async function getNote(db: Db, scope: ReadScope, id: string): Promise<NoteRow | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(readable(scope), eq(notes.id, id)));
  return row ?? null;
}

export async function getNoteByPath(
  db: Db,
  scope: ReadScope,
  path: string,
): Promise<NoteRow | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(readable(scope), eq(notes.path, path)));
  return row ?? null;
}

export interface NoteQuery {
  namespace?: string;
  /** Only notes directly in this folder below the namespace (`""` for the namespace root). */
  folder?: string;
  type?: string;
  theme?: string;
  system?: string;
  tag?: string;
  status?: string;
  /** Include deprecated notes. Off by default, as in search. */
  deprecated?: boolean;
  hubs?: boolean;
  sort?: "title" | "updated" | "health";
  limit?: number;
  offset?: number;
}

export async function listNotes(db: Db, scope: ReadScope, q: NoteQuery = {}): Promise<NoteCard[]> {
  const where = and(
    readable(scope),
    q.namespace ? eq(notes.namespace, q.namespace) : undefined,
    q.folder !== undefined ? eq(notes.folder, q.folder) : undefined,
    q.type ? eq(notes.type, q.type) : undefined,
    q.theme ? sql`${q.theme} = any(${notes.themes})` : undefined,
    q.system ? sql`${q.system} = any(${notes.systems})` : undefined,
    q.tag ? sql`${q.tag} = any(${notes.tags})` : undefined,
    q.status ? eq(notes.status, q.status) : undefined,
    q.deprecated ? undefined : sql`${notes.status} <> 'deprecated'`,
    q.hubs ? undefined : isNull(notes.hubKind),
  );
  const order =
    q.sort === "updated"
      ? [sql`${notes.lastChangedAt} desc nulls last`, asc(notes.title)]
      : q.sort === "health"
        ? [asc(notes.healthScore), asc(notes.title)]
        : [asc(notes.title)];
  return db
    .select(cardColumns)
    .from(notes)
    .where(where)
    .orderBy(...order)
    .limit(q.limit ?? 500)
    .offset(q.offset ?? 0);
}

export type Dimension = "namespace" | "type" | "theme" | "system" | "tag" | "status" | "trust";

/** Note counts per value of one dimension, over readable, non-hub notes. */
export async function countBy(
  db: Db,
  scope: ReadScope,
  dim: Dimension,
): Promise<{ key: string; count: number }[]> {
  const col =
    dim === "namespace"
      ? sql`${notes.namespace}`
      : dim === "type"
        ? sql`${notes.type}`
        : dim === "status"
          ? sql`${notes.status}`
          : dim === "trust"
            ? sql`${notes.trustTier}`
            : sql`unnest(${dim === "theme" ? notes.themes : dim === "system" ? notes.systems : notes.tags})`;
  const rows = await db
    .select({ key: sql<string>`${col}`.as("key"), count: sql<number>`count(*)::int` })
    .from(notes)
    .where(and(readable(scope), isNull(notes.hubKind)))
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`, sql`1`);
  return rows.filter((r) => r.key !== null);
}

/** Folders directly below a namespace or folder, with note counts. */
export async function subfolders(
  db: Db,
  scope: ReadScope,
  namespace: string,
  folder: string,
): Promise<{ folder: string; count: number }[]> {
  const depth = folder ? folder.split("/").length + 1 : 1;
  const rows = await db
    .select({
      folder:
        sql<string>`array_to_string((string_to_array(${notes.folder}, '/'))[1:${depth}], '/')`.as(
          "f",
        ),
      count: sql<number>`count(*)::int`,
    })
    .from(notes)
    .where(
      and(
        readable(scope),
        eq(notes.namespace, namespace),
        folder ? sql`${notes.folder} like ${folder + "/%"}` : sql`${notes.folder} <> ''`,
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows;
}

export async function recentlyChanged(db: Db, scope: ReadScope, limit = 10): Promise<NoteCard[]> {
  return listNotes(db, scope, { sort: "updated", limit });
}

export async function processChangesSince(
  db: Db,
  scope: ReadScope,
  since: Date,
): Promise<NoteCard[]> {
  return db
    .select(cardColumns)
    .from(notes)
    .where(and(readable(scope), gte(notes.processChangedAt, since)))
    .orderBy(desc(notes.processChangedAt))
    .limit(20);
}

// Links.

export async function linksFrom(db: Db, vaultId: string, noteId: string) {
  return db
    .select({
      href: noteLinks.href,
      targetPath: noteLinks.targetPath,
      targetId: noteLinks.targetId,
      kind: noteLinks.kind,
      wanted: noteLinks.wanted,
      anchor: noteLinks.anchor,
      label: noteLinks.label,
      targetNamespace: notes.namespace,
      targetSlug: notes.slug,
      targetTitle: notes.title,
    })
    .from(noteLinks)
    .leftJoin(notes, and(eq(notes.vaultId, noteLinks.vaultId), eq(notes.id, noteLinks.targetId)))
    .where(and(eq(noteLinks.vaultId, vaultId), eq(noteLinks.sourceId, noteId)));
}

/** Readable notes that link to `noteId` in their body. */
export async function backlinks(db: Db, scope: ReadScope, noteId: string): Promise<NoteCard[]> {
  return db
    .selectDistinct(cardColumns)
    .from(noteLinks)
    .innerJoin(notes, and(eq(notes.vaultId, noteLinks.vaultId), eq(notes.id, noteLinks.sourceId)))
    .where(and(readable(scope), eq(noteLinks.targetId, noteId), eq(noteLinks.kind, "body")))
    .orderBy(asc(notes.title));
}

/** Readable notes that `noteId` links to. */
export async function outgoing(db: Db, scope: ReadScope, noteId: string): Promise<NoteCard[]> {
  return db
    .selectDistinct(cardColumns)
    .from(noteLinks)
    .innerJoin(notes, and(eq(notes.vaultId, noteLinks.vaultId), eq(notes.id, noteLinks.targetId)))
    .where(
      and(
        readable(scope),
        eq(noteLinks.sourceId, noteId),
        inArray(noteLinks.kind, ["body", "supersedes"]),
      ),
    )
    .orderBy(asc(notes.title));
}

/** Body links between the given notes, for drawing a local graph. */
export async function linksAmong(db: Db, vaultId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .selectDistinct({ source: noteLinks.sourceId, target: noteLinks.targetId })
    .from(noteLinks)
    .where(
      and(
        eq(noteLinks.vaultId, vaultId),
        eq(noteLinks.kind, "body"),
        inArray(noteLinks.sourceId, ids),
        inArray(noteLinks.targetId, ids),
      ),
    );
}

/** Wanted notes: missing link targets, with how many readable notes want them. */
export async function wantedNotes(db: Db, scope: ReadScope, limit = 50) {
  return db
    .select({
      targetPath: noteLinks.targetPath,
      count: sql<number>`count(distinct ${noteLinks.sourceId})::int`,
    })
    .from(noteLinks)
    .innerJoin(notes, and(eq(notes.vaultId, noteLinks.vaultId), eq(notes.id, noteLinks.sourceId)))
    .where(and(readable(scope), eq(noteLinks.wanted, true)))
    .groupBy(noteLinks.targetPath)
    .orderBy(sql`2 desc`)
    .limit(limit);
}

// History and assets.

export async function noteHistory(db: Db, vaultId: string, noteId: string, limit = 20) {
  return db
    .select({
      sha: noteCommits.sha,
      status: noteCommits.status,
      path: noteCommits.path,
      fromVersion: noteCommits.fromVersion,
      toVersion: noteCommits.toVersion,
      changeClass: noteCommits.changeClass,
      committedAt: noteCommits.committedAt,
      authorName: commits.authorName,
      subject: commits.subject,
    })
    .from(noteCommits)
    .innerJoin(
      commits,
      and(eq(commits.vaultId, noteCommits.vaultId), eq(commits.sha, noteCommits.sha)),
    )
    .where(and(eq(noteCommits.vaultId, vaultId), eq(noteCommits.noteId, noteId)))
    .orderBy(desc(noteCommits.committedAt))
    .limit(limit);
}

/** One entry of a note's history, or null when the commit did not touch the note. */
export async function noteCommit(db: Db, vaultId: string, noteId: string, sha: string) {
  const [row] = await db
    .select({
      sha: noteCommits.sha,
      status: noteCommits.status,
      path: noteCommits.path,
      fromVersion: noteCommits.fromVersion,
      toVersion: noteCommits.toVersion,
      changeClass: noteCommits.changeClass,
      committedAt: noteCommits.committedAt,
      authorName: commits.authorName,
      subject: commits.subject,
      body: commits.body,
    })
    .from(noteCommits)
    .innerJoin(
      commits,
      and(eq(commits.vaultId, noteCommits.vaultId), eq(commits.sha, noteCommits.sha)),
    )
    .where(
      and(
        eq(noteCommits.vaultId, vaultId),
        eq(noteCommits.noteId, noteId),
        eq(noteCommits.sha, sha),
      ),
    );
  return row ?? null;
}

/** An asset, only when its namespace is readable. */
export async function getAsset(db: Db, scope: ReadScope, path: string): Promise<AssetRow | null> {
  const ns = scope.namespaces.length
    ? or(inArray(assets.namespace, scope.namespaces), isNull(assets.namespace))
    : isNull(assets.namespace);
  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.vaultId, scope.vaultId), eq(assets.path, path), ns));
  return row ?? null;
}

// Settings.

export async function getSetting<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as T | undefined) ?? null;
}
