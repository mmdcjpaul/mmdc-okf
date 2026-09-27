/** Write side used by the worker's index job. The web app never calls these. */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  assets,
  commits,
  embeddingCache,
  namespaces,
  noteCommits,
  noteLinks,
  notes,
  taxonomyTerms,
  vaults,
  type AssetRow,
  type CommitRow,
  type NamespaceRow,
  type NewNoteRow,
  type NoteCommitRow,
  type TermRow,
  type Vault,
} from "../schema.ts";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function upsertVault(
  db: Db,
  row: Pick<Vault, "id" | "slug" | "title" | "repository" | "branch" | "bundleRoot">,
): Promise<void> {
  await db
    .insert(vaults)
    .values(row)
    .onConflictDoUpdate({
      target: vaults.id,
      set: {
        title: row.title,
        repository: row.repository,
        branch: row.branch,
        bundleRoot: row.bundleRoot,
      },
    });
}

export async function getVault(db: Db, id: string): Promise<Vault | null> {
  const [row] = await db.select().from(vaults).where(eq(vaults.id, id));
  return row ?? null;
}

export async function listVaults(db: Db): Promise<Vault[]> {
  return db.select().from(vaults);
}

/** Row hashes and paths of every indexed note, for change detection. */
export async function noteRowHashes(
  db: Db,
  vaultId: string,
): Promise<Map<string, { rowHash: string; path: string; version: string | null }>> {
  const rows = await db
    .select({ id: notes.id, rowHash: notes.rowHash, path: notes.path, version: notes.version })
    .from(notes)
    .where(eq(notes.vaultId, vaultId));
  return new Map(rows.map((r) => [r.id, { rowHash: r.rowHash, path: r.path, version: r.version }]));
}

export async function assetShas(db: Db, vaultId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ path: assets.path, blobSha: assets.blobSha })
    .from(assets)
    .where(eq(assets.vaultId, vaultId));
  return new Map(rows.map((r) => [r.path, r.blobSha]));
}

export interface LinkInput {
  href: string;
  targetPath: string;
  targetId: string | null;
  kind: "body" | "image" | "supersedes";
  wanted: boolean;
  anchor: string | null;
  label: string;
}

export interface IndexWrite {
  vaultId: string;
  head: string;
  profile: Record<string, unknown>;
  namespaces: Omit<NamespaceRow, "vaultId">[];
  terms: Omit<TermRow, "vaultId">[];
  upserts: NewNoteRow[];
  deletes: string[];
  /** Replacement link sets, keyed by source note id. */
  links: Map<string, LinkInput[]>;
  commits: CommitRow[];
  noteCommits: NoteCommitRow[];
  assets: AssetRow[];
  assetDeletes: string[];
}

/**
 * Writes one index run in a single transaction, ending with `last_indexed_head`. A crash
 * before commit leaves the previous head in place, so the job simply runs again.
 */
export async function writeIndex(db: Db, w: IndexWrite): Promise<void> {
  await db.transaction(async (tx) => {
    await syncNamespaces(tx, w.vaultId, w.namespaces);
    await syncTerms(tx, w.vaultId, w.terms);
    if (w.deletes.length) {
      await tx.delete(notes).where(and(eq(notes.vaultId, w.vaultId), inArray(notes.id, w.deletes)));
      await tx
        .delete(noteLinks)
        .where(and(eq(noteLinks.vaultId, w.vaultId), inArray(noteLinks.sourceId, w.deletes)));
      // History belongs to live notes, so a rebuild from scratch ends with the same rows.
      await tx
        .delete(noteCommits)
        .where(and(eq(noteCommits.vaultId, w.vaultId), inArray(noteCommits.noteId, w.deletes)));
    }
    for (const batch of chunks(w.upserts, 200)) {
      await tx
        .insert(notes)
        .values(batch)
        .onConflictDoUpdate({
          target: [notes.vaultId, notes.id],
          set: Object.fromEntries(
            Object.keys(batch[0]!)
              .filter((k) => k !== "vaultId" && k !== "id")
              .map((k) => [k, sql.raw(`excluded.${snake(k)}`)]),
          ),
        });
    }
    const sources = [...w.links.keys()];
    for (const batch of chunks(sources, 500)) {
      await tx
        .delete(noteLinks)
        .where(and(eq(noteLinks.vaultId, w.vaultId), inArray(noteLinks.sourceId, batch)));
    }
    const linkRows = [...w.links].flatMap(([sourceId, links]) =>
      links.map((l) => ({ ...l, vaultId: w.vaultId, sourceId })),
    );
    for (const batch of chunks(linkRows, 1000)) await tx.insert(noteLinks).values(batch);
    for (const batch of chunks(w.commits, 500)) {
      await tx.insert(commits).values(batch).onConflictDoNothing();
    }
    for (const batch of chunks(w.noteCommits, 1000)) {
      await tx.insert(noteCommits).values(batch).onConflictDoNothing();
    }
    if (w.assetDeletes.length) {
      await tx
        .delete(assets)
        .where(and(eq(assets.vaultId, w.vaultId), inArray(assets.path, w.assetDeletes)));
    }
    for (const batch of chunks(w.assets, 500)) {
      await tx
        .insert(assets)
        .values(batch)
        .onConflictDoUpdate({
          target: [assets.vaultId, assets.path],
          set: {
            blobSha: sql`excluded.blob_sha`,
            mime: sql`excluded.mime`,
            size: sql`excluded.size`,
            namespace: sql`excluded.namespace`,
          },
        });
    }
    await tx
      .update(vaults)
      .set({ lastIndexedHead: w.head, lastIndexedAt: new Date(), profile: w.profile })
      .where(eq(vaults.id, w.vaultId));
  });
}

async function syncNamespaces(tx: Tx, vaultId: string, rows: Omit<NamespaceRow, "vaultId">[]) {
  const slugs = rows.map((r) => r.slug);
  await tx
    .delete(namespaces)
    .where(
      and(
        eq(namespaces.vaultId, vaultId),
        slugs.length ? notInArray(namespaces.slug, slugs) : undefined,
      ),
    );
  for (const r of rows) {
    const { slug: _slug, ...rest } = r;
    await tx
      .insert(namespaces)
      .values({ ...r, vaultId })
      .onConflictDoUpdate({ target: [namespaces.vaultId, namespaces.slug], set: rest });
  }
}

async function syncTerms(tx: Tx, vaultId: string, rows: Omit<TermRow, "vaultId">[]) {
  await tx.delete(taxonomyTerms).where(eq(taxonomyTerms.vaultId, vaultId));
  for (const batch of chunks(rows, 500)) {
    await tx.insert(taxonomyTerms).values(batch.map((r) => ({ ...r, vaultId })));
  }
}

/** Updates `last_changed_*` and `process_changed_at` from the commit history. */
export async function refreshNoteChangeInfo(db: Db, vaultId: string): Promise<void> {
  await db.execute(sql`
    update notes n set
      last_commit_sha = h.sha,
      last_changed_at = h.committed_at,
      last_changed_by = h.author_name,
      process_changed_at = p.at
    from (
      select distinct on (nc.note_id) nc.note_id, nc.sha, nc.committed_at, c.author_name
      from note_commits nc join commits c on c.vault_id = nc.vault_id and c.sha = nc.sha
      where nc.vault_id = ${vaultId}
      order by nc.note_id, nc.committed_at desc
    ) h
    left join (
      select note_id, max(committed_at) as at from note_commits
      where vault_id = ${vaultId} and change_class = 'process' group by note_id
    ) p on p.note_id = h.note_id
    where n.vault_id = ${vaultId} and n.id = h.note_id
      and (n.last_commit_sha is distinct from h.sha or n.process_changed_at is distinct from p.at)
  `);
}

// Staleness. It depends on the clock, not on the vault, so it is refreshed outside the index run.

export interface StaleDrift {
  id: string;
  /** The value `stale` should have at `now`. */
  stale: boolean;
  trustTier: string;
  brokenLinks: number;
}

/** Notes whose stored `stale` flag no longer matches their `stale_after` date at `now`. */
export async function staleDrift(db: Db, vaultId: string, now: Date): Promise<StaleDrift[]> {
  const at = now.toISOString();
  const rows = await db.execute<{
    id: string;
    stale: boolean;
    trust_tier: string;
    broken_links: number;
  }>(sql`
    select n.id,
      (n.stale_after is not null and n.stale_after <= ${at}::timestamptz) as stale,
      n.trust_tier,
      (select count(*)::int from note_links l
        where l.vault_id = n.vault_id and l.source_id = n.id and l.wanted) as broken_links
    from notes n
    where n.vault_id = ${vaultId}
      and n.stale <> (n.stale_after is not null and n.stale_after <= ${at}::timestamptz)
    order by n.id
  `);
  return [...rows].map((r) => ({
    id: r.id,
    stale: r.stale,
    trustTier: r.trust_tier,
    brokenLinks: r.broken_links,
  }));
}

export async function setStaleness(
  db: Db,
  vaultId: string,
  updates: { id: string; stale: boolean; healthScore: number }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(notes)
        .set({ stale: u.stale, healthScore: u.healthScore })
        .where(and(eq(notes.vaultId, vaultId), eq(notes.id, u.id)));
    }
  });
}

// Embedding cache.

export async function cachedEmbeddings(
  db: Db,
  model: string,
  hashes: string[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (const batch of chunks([...new Set(hashes)], 1000)) {
    const rows = await db
      .select({ hash: embeddingCache.contentHash, vector: embeddingCache.vector })
      .from(embeddingCache)
      .where(and(eq(embeddingCache.model, model), inArray(embeddingCache.contentHash, batch)));
    for (const r of rows) out.set(r.hash, r.vector);
  }
  return out;
}

export async function storeEmbeddings(
  db: Db,
  model: string,
  entries: Map<string, number[]>,
): Promise<void> {
  const rows = [...entries].map(([contentHash, vector]) => ({ model, contentHash, vector }));
  for (const batch of chunks(rows, 200)) {
    await db.insert(embeddingCache).values(batch).onConflictDoNothing();
  }
}

/** Removes every indexed row for a vault. Used by `lore reindex --all`. */
export async function clearVaultIndex(db: Db, vaultId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(notes).where(eq(notes.vaultId, vaultId));
    await tx.delete(noteLinks).where(eq(noteLinks.vaultId, vaultId));
    await tx.delete(noteCommits).where(eq(noteCommits.vaultId, vaultId));
    await tx.delete(commits).where(eq(commits.vaultId, vaultId));
    await tx.delete(assets).where(eq(assets.vaultId, vaultId));
    await tx.delete(taxonomyTerms).where(eq(taxonomyTerms.vaultId, vaultId));
    await tx.update(vaults).set({ lastIndexedHead: null }).where(eq(vaults.id, vaultId));
  });
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}
