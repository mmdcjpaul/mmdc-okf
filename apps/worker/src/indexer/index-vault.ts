/**
 * The index job (plans/02-library.md, L3). Reads the vault at the branch head from the mirror,
 * writes changed notes, links, and history to Postgres, and changed documents to Meilisearch.
 *
 * Every run derives rows for the whole tree and writes only rows whose hash changed, so an
 * incremental run and a rebuild from scratch end in the same state.
 */
import { createHash } from "node:crypto";
import type { Embedder } from "@lore/ai";
import {
  assetShas,
  cachedEmbeddings,
  getVault,
  noteRowHashes,
  refreshNoteChangeInfo,
  storeEmbeddings,
  writeIndex,
  type CommitRow,
  type Db,
  type NoteCommitRow,
} from "@lore/db";
import { GitTreeSource, type Mirror } from "@lore/git";
import { chunkNote, loadVault } from "@lore/okf";
import {
  ensureIndexes,
  indexNames,
  type ChunkDoc,
  type Meilisearch,
  type NoteDoc,
} from "@lore/search";
import type { Logger } from "pino";
import { blobKey, type ObjectStore } from "@lore/ingest";
import { refreshStale } from "./refresh-stale.ts";
import {
  classFromVersions,
  deriveAssets,
  deriveNamespaces,
  deriveNotes,
  deriveSynonyms,
  deriveTerms,
  idOfRevision,
  noteDoc,
  versionOf,
  type DerivedNote,
} from "./derive.ts";

export interface IndexDeps {
  db: Db;
  meili: Meilisearch;
  mirrorFor: (repository: string) => Mirror;
  embedder: Embedder | null;
  objects: ObjectStore;
  log: Logger;
  now?: () => Date;
}

export interface IndexResult {
  vaultId: string;
  head: string | null;
  previousHead: string | null;
  notes: number;
  changed: string[];
  deleted: string[];
  embedded: number;
  processChanged: string[];
  skipped: boolean;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function indexVault(deps: IndexDeps, vaultId: string): Promise<IndexResult> {
  const { db, meili, log } = deps;
  const now = deps.now?.() ?? new Date();
  const vault = await getVault(db, vaultId);
  if (!vault) throw new Error(`Unknown vault ${vaultId}`);
  const mirror = deps.mirrorFor(vault.repository);
  const head = await mirror.resolve(`refs/heads/${vault.branch}`);
  const base: IndexResult = {
    vaultId,
    head,
    previousHead: vault.lastIndexedHead,
    notes: 0,
    changed: [],
    deleted: [],
    embedded: 0,
    processChanged: [],
    skipped: false,
  };
  if (!head) {
    log.warn({ vaultId }, "vault branch has no commits; nothing to index");
    return { ...base, skipped: true };
  }
  if (head === vault.lastIndexedHead) {
    // Nothing was pushed, but a note may have passed its review date since the last run.
    await refreshStale(deps, vaultId);
    return { ...base, skipped: true };
  }

  // 1. Load the tree at head.
  const root = vault.bundleRoot.replace(/\/+$/, "");
  const src = await new GitTreeSource(mirror, head).load([root + "/", ".kb/"]);
  const loaded = await loadVault(src);
  const tree = src.tree();

  // 2 and 3. Derive rows and compare with what is stored.
  const { notes: derived, duplicateIds } = deriveNotes(
    loaded,
    (p) => tree.get(p)?.blobSha ?? "",
    now,
  );
  for (const d of duplicateIds) log.warn(d, "duplicate note id; the first path wins");
  const stored = await noteRowHashes(db, vaultId);
  const changed: DerivedNote[] = [];
  for (const d of derived) {
    d.row.vaultId = vaultId;
    if (stored.get(d.row.id)?.rowHash !== d.row.rowHash) changed.push(d);
  }
  const liveIds = new Set(derived.map((d) => d.row.id));
  const deleted = [...stored.keys()].filter((id) => !liveIds.has(id));
  const idOfPath = new Map(derived.map((d) => [d.row.path, d.row.id]));
  const folders = [...new Set(derived.map((d) => d.row.namespace).filter((n): n is string => !!n))];

  // 5. History since the last indexed head, with change classes.
  const history = await readHistory(mirror, vault.lastIndexedHead, head, root, liveIds);

  // 6. Chunk and embed only what is missing from the cache.
  const { noteDocs, chunkDocs, embedded } = await buildDocs(deps, changed, loaded);

  // 7. Assets into the object store under their blob SHA.
  const assets = deriveAssets(root, tree.values());
  const knownAssets = await assetShas(db, vaultId);
  const newAssets = assets.filter((a) => knownAssets.get(a.path) !== a.blobSha);
  if (newAssets.length) {
    const blobs = await mirror.readBlobs(newAssets.map((a) => a.blobSha));
    for (const a of newAssets) {
      const bytes = blobs.get(a.blobSha);
      const key = blobKey(a.blobSha);
      if (bytes && !(await deps.objects.has(key)))
        await deps.objects.put(key, bytes, { contentType: a.mime });
    }
  }
  const livePaths = new Set(assets.map((a) => a.path));
  const assetDeletes = [...knownAssets.keys()].filter((p) => !livePaths.has(p));

  // Meilisearch first, waiting for its tasks, so the head is recorded only once both agree.
  const names = indexNames(vault.slug);
  await ensureIndexes(meili, vault.slug, deriveSynonyms(loaded));
  const tasks = [];
  const gone = [...deleted, ...changed.map((d) => d.row.id)];
  if (deleted.length) tasks.push(meili.index(names.notes).deleteDocuments(deleted));
  for (let i = 0; i < gone.length; i += 200) {
    const ids = gone
      .slice(i, i + 200)
      .map((id) => JSON.stringify(id))
      .join(", ");
    tasks.push(meili.index(names.chunks).deleteDocuments({ filter: `note_id IN [${ids}]` }));
  }
  const tasksDone = await Promise.all(tasks);
  await meili.tasks.waitForTasks(
    tasksDone.map((t) => t.taskUid),
    { timeout: 300_000 },
  );
  const adds = [];
  for (let i = 0; i < noteDocs.length; i += 500) {
    adds.push(await meili.index<NoteDoc>(names.notes).addDocuments(noteDocs.slice(i, i + 500)));
  }
  for (let i = 0; i < chunkDocs.length; i += 1000) {
    adds.push(await meili.index<ChunkDoc>(names.chunks).addDocuments(chunkDocs.slice(i, i + 1000)));
  }
  const finished = await meili.tasks.waitForTasks(
    adds.map((t) => t.taskUid),
    { timeout: 600_000 },
  );
  const failed = finished.filter((t) => t.status !== "succeeded");
  if (failed.length)
    throw new Error(`Meilisearch task failed: ${JSON.stringify(failed[0]?.error)}`);

  // 8. Postgres in one transaction, ending with the head.
  await writeIndex(db, {
    vaultId,
    head,
    profile: loaded.profile as unknown as Record<string, unknown>,
    namespaces: deriveNamespaces(loaded, folders),
    terms: deriveTerms(loaded, idOfPath),
    upserts: changed.map((d) => d.row),
    deletes: deleted,
    links: new Map(changed.map((d) => [d.row.id, d.links])),
    commits: history.commits.map((c) => ({ ...c, vaultId })),
    noteCommits: history.noteCommits.map((c) => ({ ...c, vaultId })),
    assets: newAssets.map((a) => ({ ...a, vaultId })),
    assetDeletes,
  });
  await refreshNoteChangeInfo(db, vaultId);
  await syncUpdatedAt(deps, vault.slug, vaultId, changed, history.noteCommits);
  await refreshStale(deps, vaultId);

  const result: IndexResult = {
    ...base,
    notes: derived.length,
    changed: changed.map((d) => d.row.id),
    deleted,
    embedded,
    processChanged: [
      ...new Set(
        history.noteCommits.filter((c) => c.changeClass === "process").map((c) => c.noteId),
      ),
    ],
  };
  log.info(
    {
      vaultId,
      head,
      notes: result.notes,
      changed: result.changed.length,
      deleted: deleted.length,
      embedded,
      commits: history.commits.length,
    },
    "vault indexed",
  );
  return result;
}

async function buildDocs(
  deps: IndexDeps,
  changed: DerivedNote[],
  loaded: Awaited<ReturnType<typeof loadVault>>,
) {
  const noteDocs: NoteDoc[] = [];
  const chunkDocs: ChunkDoc[] = [];
  const pending: { hash: string; text: string }[] = [];
  const chunked = changed.map((d) => {
    const chunks = d.row.hubKind ? [] : chunkNote(d.note, loaded);
    const card = { hash: sha256("card\n" + d.cardText), text: d.cardText };
    pending.push(
      card,
      ...chunks.map((c) => ({ hash: c.contentHash, text: c.header + "\n\n" + c.text })),
    );
    return { d, chunks, card };
  });

  let vectors = new Map<string, number[]>();
  let embedded = 0;
  const embedder = deps.embedder;
  if (embedder && pending.length) {
    try {
      vectors = await cachedEmbeddings(
        deps.db,
        embedder.model,
        pending.map((p) => p.hash),
      );
      const missing = [
        ...new Map(pending.filter((p) => !vectors.has(p.hash)).map((p) => [p.hash, p])).values(),
      ];
      const fresh = new Map<string, number[]>();
      for (let i = 0; i < missing.length; i += 64) {
        const batch = missing.slice(i, i + 64);
        const out = await embedder.embed(batch.map((b) => b.text));
        batch.forEach((b, j) => fresh.set(b.hash, out[j]!));
      }
      embedded = fresh.size;
      await storeEmbeddings(deps.db, embedder.model, fresh);
      for (const [k, v] of fresh) vectors.set(k, v);
    } catch (err) {
      // LB-6: keyword search keeps working when embeddings fail.
      deps.log.warn(
        { err: (err as Error).message },
        "embeddings unavailable; indexing without vectors",
      );
      vectors = new Map();
    }
  }

  for (const { d, chunks, card } of chunked) {
    const doc = noteDoc(d, vectors.get(card.hash) ?? null);
    noteDocs.push(doc);
    for (const c of chunks) {
      chunkDocs.push({
        id: `${d.row.id}-${c.position}`,
        note_id: d.row.id,
        note_title: d.row.title,
        slug: d.row.slug,
        position: c.position,
        heading_path: c.headingPath,
        header: c.header,
        text: c.text,
        namespace: doc.namespace,
        is_hub: doc.is_hub,
        type: doc.type,
        status: doc.status,
        trust_tier: doc.trust_tier,
        stale: doc.stale,
        desk: doc.desk,
        themes: doc.themes,
        systems: doc.systems,
        tags: doc.tags,
        _vectors: { default: vectors.get(c.contentHash) ?? null },
      });
    }
  }
  return { noteDocs, chunkDocs, embedded };
}

/**
 * Commits between the two heads, newest first, mapped to note ids. Each revision's id comes
 * from its own blob, and only notes that exist at the head keep history, so an incremental
 * run and a rebuild record the same rows. For commits Lore did not make, the change class
 * comes from the version bump (a major bump is a Process change).
 */
async function readHistory(
  mirror: Mirror,
  from: string | null,
  to: string,
  root: string,
  liveIds: Set<string>,
): Promise<{
  commits: Omit<CommitRow, "vaultId">[];
  noteCommits: Omit<NoteCommitRow, "vaultId">[];
}> {
  const log = await mirror.log(from, to);
  const isNote = (p: string) => p.startsWith(root + "/") && p.endsWith(".md");
  const shas = log.flatMap((c) =>
    c.files.filter((f) => isNote(f.path)).flatMap((f) => [f.oldSha, f.newSha]),
  );
  const blobs = await mirror.readBlobs(shas.filter((s): s is string => !!s));
  const decoder = new TextDecoder();
  const text = (sha?: string) => {
    const b = sha ? blobs.get(sha) : undefined;
    return b ? decoder.decode(b) : null;
  };

  const commits: Omit<CommitRow, "vaultId">[] = [];
  const noteCommits: Omit<NoteCommitRow, "vaultId">[] = [];
  for (const c of log) {
    const trailer = c.trailers["change-class"]?.toLowerCase();
    const declared =
      trailer === "fix" || trailer === "addition" || trailer === "process" ? trailer : null;
    let commitClass: "fix" | "addition" | "process" | null = declared;
    for (const f of c.files) {
      if (!isNote(f.path) || f.status === "D") continue;
      const after = text(f.newSha);
      if (after === null) continue;
      const id = idOfRevision(after, f.path);
      if (!liveIds.has(id)) continue;
      const before = f.status === "A" ? null : text(f.oldSha);
      const fromVersion = before === null ? null : versionOf(before);
      const toVersion = versionOf(after);
      const cls = declared ?? classFromVersions(fromVersion, toVersion);
      if (!declared && cls === "process") commitClass = "process";
      noteCommits.push({
        noteId: id,
        sha: c.sha,
        path: f.path,
        status: f.status,
        fromVersion,
        toVersion,
        changeClass: cls,
        committedAt: c.committedAt,
      });
    }
    commits.push({
      sha: c.sha,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      committedAt: c.committedAt,
      subject: c.subject,
      body: c.body,
      changeClass: commitClass,
    });
  }
  return { commits, noteCommits };
}

/** Puts the last-change time on search documents so results can sort by it. */
async function syncUpdatedAt(
  deps: IndexDeps,
  vaultSlug: string,
  vaultId: string,
  changed: DerivedNote[],
  noteCommits: Omit<NoteCommitRow, "vaultId">[],
): Promise<void> {
  const ids = new Set([...changed.map((d) => d.row.id), ...noteCommits.map((c) => c.noteId)]);
  if (ids.size === 0) return;
  const rows = await deps.db.query.notes.findMany({
    columns: { id: true, lastChangedAt: true },
    where: (n, { and, eq, inArray }) => and(eq(n.vaultId, vaultId), inArray(n.id, [...ids])),
  });
  const updates = rows.map((r) => ({
    id: r.id,
    updated_at: r.lastChangedAt ? Math.floor(r.lastChangedAt.getTime() / 1000) : 0,
  }));
  const task = await deps.meili.index(indexNames(vaultSlug).notes).updateDocuments(updates);
  await deps.meili.tasks.waitForTask(task.taskUid, { timeout: 300_000 });
}
