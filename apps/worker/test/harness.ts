/**
 * Integration harness: a scratch database, scratch Meilisearch indexes, and a bare repository
 * seeded from a fixture vault. Needs the dev compose services (`pnpm services:up`).
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HashEmbedder } from "@lore/ai";
import { clearVaultIndex, createDb, seedPrincipals, upsertVault, type Db } from "@lore/db";
import { migrateDb } from "@lore/db/migrate";
import { commitWorkingTree, initBareRepo } from "@lore/git";
import { dropIndexes, indexNames, Meilisearch } from "@lore/search";
import pino from "pino";
import postgres from "postgres";
import { newRecordId, toStoredOps, type ChangesetIntent } from "@lore/changesets";
import {
  addReview,
  createChangeset,
  getChangeset,
  transitionChangeset,
  type ChangesetRow,
} from "@lore/db";
import { gitBlobSha, type FileOp } from "@lore/okf";
import { applyIndexEffects } from "../src/changesets/effects.ts";
import {
  processChangeset,
  type ChangesetDeps,
  type ProcessOutcome,
} from "../src/changesets/process.ts";
import { indexVault, type IndexDeps } from "../src/indexer/index-vault.ts";
import { FsObjectStore } from "@lore/ingest";
import { loadPrincipals } from "../src/principals.ts";
import { mirrorFor, providerFor } from "../src/runtime.ts";

export const REPO = resolve(import.meta.dirname, "../../..");
export const FIXTURE = join(REPO, "fixtures/vault-acme");
/** Tests treat this as now so stale results do not drift (fixtures/README.md). */
export const NOW = new Date("2026-09-24T00:00:00Z");

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://lore:lore@127.0.0.1:5433/lore";
const MEILI_URL = process.env.TEST_MEILI_URL ?? "http://127.0.0.1:7701";
const MEILI_KEY = process.env.TEST_MEILI_KEY ?? "lore-dev-master-key";

/**
 * Integration tests never skip: a run that cannot reach the services fails, so a green run
 * always means the indexer and permission tests really ran.
 */
export async function servicesAvailable(): Promise<true> {
  if (!(await probe())) {
    throw new Error(
      `Postgres (${ADMIN_URL.replace(/\/\/.*@/, "//")}) or Meilisearch (${MEILI_URL}) is not reachable. ` +
        "Run `pnpm services:up`.",
    );
  }
  return true;
}

async function probe(): Promise<boolean> {
  try {
    const sql = postgres(ADMIN_URL, { max: 1, connect_timeout: 2, onnotice: () => {} });
    await sql`select 1`;
    await sql.end();
    const res = await fetch(`${MEILI_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface Harness {
  db: Db;
  meili: Meilisearch;
  deps: IndexDeps;
  vaultId: string;
  slug: string;
  bare: string;
  /** The time the index job sees. Tests move it to let review dates pass. */
  clock: { now: Date };
  /** A working copy of the fixture; edit it and call `push`. */
  work: string;
  push(message: string, author?: { name: string; email: string }): Promise<string | null>;
  index(): ReturnType<typeof indexVault>;
  /** Indexes and applies the effects of process changes, as the worker's index job does. */
  indexWithEffects(): Promise<Awaited<ReturnType<typeof applyIndexEffects>>>;
  changesets: ChangesetDeps;
  /** Text of a file at the branch head. */
  read(path: string): Promise<string | null>;
  /** Saves a changeset the way the web app does, without processing it. */
  save(input: SaveInput): Promise<ChangesetRow>;
  /** Saves a changeset and runs the worker's job on it. */
  submit(input: SaveInput): Promise<{ cs: ChangesetRow; outcome: ProcessOutcome }>;
  /** Records a reviewer's approval and runs the job again. */
  approve(id: string, reviewerId: string): Promise<{ cs: ChangesetRow; outcome: ProcessOutcome }>;
  rebuild(): ReturnType<typeof indexVault>;
  close(): Promise<void>;
}

export interface SaveInput {
  by: string;
  source?: ChangesetRow["source"];
  changeClass?: ChangesetRow["changeClass"];
  /** Edits to files that exist: the base blob SHA is taken from the head. */
  edit?: Record<string, (text: string) => string>;
  ops?: FileOp[];
  intents?: ChangesetIntent[];
  verify?: boolean;
  reason?: string;
  summary?: string;
  aiDrafted?: boolean;
  actor?: string;
}

export async function createHarness(name: string): Promise<Harness> {
  const dbName = `lore_test_${name.replace(/\W/g, "_")}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();

  const db = createDb(ADMIN_URL.replace(/\/[^/]+$/, `/${dbName}`), { max: 4 });
  await migrateDb(db);
  const meili = new Meilisearch({ host: MEILI_URL, apiKey: MEILI_KEY });
  const slug = `test-${name}`;
  await dropIndexes(meili, slug);

  const tmp = await mkdtemp(join(tmpdir(), `lore-${name}-`));
  const bare = join(tmp, "vault.git");
  const work = join(tmp, "work");
  await cp(FIXTURE, work, { recursive: true });
  await initBareRepo(bare);
  await commitWorkingTree(bare, work, "main", "Import vault-acme");
  await upsertVault(db, {
    id: slug,
    slug,
    title: "Acme",
    repository: `local:${bare}`,
    branch: "main",
    bundleRoot: "kb",
  });
  await seedPrincipals(db, slug, loadPrincipals(join(REPO, "fixtures/principals.yaml")));

  const clock = { now: NOW };
  const deps: IndexDeps = {
    db,
    meili,
    mirrorFor,
    embedder: new HashEmbedder(),
    objects: new FsObjectStore(join(tmp, "objects")),
    log: pino({ level: "silent" }),
    now: () => clock.now,
  };
  const changesets: ChangesetDeps = {
    db,
    log: deps.log,
    mirrorFor,
    providerFor: (repository) => providerFor(repository),
    now: () => clock.now,
  };
  const read = async (path: string) => {
    const mirror = mirrorFor(`local:${bare}`);
    const head = await mirror.resolve("refs/heads/main");
    const entry = head ? (await mirror.listTree(head)).find((e) => e.path === path) : undefined;
    if (!entry) return null;
    const bytes = (await mirror.readBlobs([entry.blobSha])).get(entry.blobSha);
    return bytes ? new TextDecoder().decode(bytes) : null;
  };
  const save = async (input: SaveInput) => {
    const ops: FileOp[] = [...(input.ops ?? [])];
    const baseShas: Record<string, string | null> = {};
    for (const [path, fn] of Object.entries(input.edit ?? {})) {
      const text = await read(path);
      if (text === null) throw new Error(`No file at ${path}`);
      baseShas[path] = gitBlobSha(text);
      ops.push({ op: "put", path, content: fn(text) });
    }
    return createChangeset(db, {
      id: newRecordId("cs", clock.now),
      vaultId: slug,
      submitterId: input.by,
      actor: input.actor ?? `human:${input.by}`,
      source: input.source ?? "editor",
      aiDrafted: input.aiDrafted ?? false,
      changeClass: input.changeClass ?? "fix",
      state: "submitted",
      title: "",
      reason: input.reason ?? null,
      summary: input.summary ?? null,
      verify: input.verify ?? false,
      ops: toStoredOps(ops),
      intents: input.intents ?? [],
      baseShas,
      submittedAt: clock.now,
    });
  };
  const run = async (id: string) => {
    const outcome = await processChangeset(changesets, id);
    return { cs: (await getChangeset(db, id))!, outcome };
  };
  return {
    changesets,
    read,
    save,
    submit: async (input) => run((await save(input)).id),
    async approve(id, reviewerId) {
      await addReview(db, { changesetId: id, reviewerId, decision: "approve", comment: null });
      await transitionChangeset(db, id, ["in_review"], "approved");
      return run(id);
    },
    async indexWithEffects() {
      return applyIndexEffects(db, await indexVault(deps, slug));
    },
    clock,
    db,
    meili,
    deps,
    vaultId: slug,
    slug,
    bare,
    work,
    push: (message, author) => commitWorkingTree(bare, work, "main", message, author),
    index: () => indexVault(deps, slug),
    async rebuild() {
      await clearVaultIndex(db, slug);
      await dropIndexes(meili, slug);
      return indexVault(deps, slug);
    },
    async close() {
      await dropIndexes(meili, slug);
      await db.$client.end({ timeout: 5 });
      await rm(tmp, { recursive: true, force: true });
    },
  };
}

/** Every indexed row and search document, normalized for comparison. */
export async function dump(h: Harness): Promise<unknown> {
  const sql = h.db.$client;
  const rows = async (q: string) => JSON.parse(JSON.stringify(await sql.unsafe(q, [h.vaultId])));
  const names = indexNames(h.slug);
  const docs = async (uid: string) => {
    const res = await h.meili.index(uid).getDocuments({ limit: 100_000, retrieveVectors: true });
    return [...res.results].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return {
    notes: await rows("select * from notes where vault_id = $1 order by id"),
    links: await rows(
      "select source_id, href, target_path, target_id, kind, wanted, anchor, label from note_links where vault_id = $1 order by source_id, kind, href",
    ),
    noteCommits: await rows("select * from note_commits where vault_id = $1 order by note_id, sha"),
    commits: await rows("select * from commits where vault_id = $1 order by sha"),
    namespaces: await rows("select * from namespaces where vault_id = $1 order by slug"),
    terms: await rows("select * from taxonomy_terms where vault_id = $1 order by kind, slug"),
    assets: await rows("select * from assets where vault_id = $1 order by path"),
    notesIndex: await docs(names.notes),
    chunksIndex: await docs(names.chunks),
  };
}

/** Strips the per-run timestamp so dumps from two runs compare equal. */
export function normalize(d: unknown): unknown {
  const x = d as { notes: Record<string, unknown>[] };
  return { ...x, notes: x.notes.map(({ indexed_at: _i, ...rest }) => rest) };
}
