/**
 * Integration harness: a scratch database, scratch Meilisearch indexes, and a bare repository
 * seeded from a fixture vault. Needs the dev compose services (`pnpm services:up`); tests skip
 * when they are not reachable.
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
import { indexVault, type IndexDeps } from "../src/indexer/index-vault.ts";
import { FsObjectStore } from "@lore/ingest";
import { loadPrincipals } from "../src/principals.ts";
import { mirrorFor } from "../src/runtime.ts";

export const REPO = resolve(import.meta.dirname, "../../..");
export const FIXTURE = join(REPO, "fixtures/vault-acme");
/** Tests treat this as now so stale results do not drift (fixtures/README.md). */
export const NOW = new Date("2026-09-24T00:00:00Z");

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://lore:lore@127.0.0.1:5433/lore";
const MEILI_URL = process.env.TEST_MEILI_URL ?? "http://127.0.0.1:7701";
const MEILI_KEY = process.env.TEST_MEILI_KEY ?? "lore-dev-master-key";

/** True when the services are up. CI sets LORE_REQUIRE_SERVICES so the tests fail instead of skipping. */
export async function servicesAvailable(): Promise<boolean> {
  const ok = await probe();
  if (!ok && process.env.LORE_REQUIRE_SERVICES)
    throw new Error("Postgres or Meilisearch is not reachable");
  return ok;
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
  rebuild(): ReturnType<typeof indexVault>;
  close(): Promise<void>;
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
  return {
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
