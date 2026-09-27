import { join } from "node:path";
import { embedderFor } from "@lore/ai";
import { createDb, type Db } from "@lore/db";
import { migrateDb } from "@lore/db/migrate";
import { LocalGitProvider, Mirror, type GitProvider } from "@lore/git";
import { Meilisearch } from "@lore/search";
import { PgBoss } from "pg-boss";
import pino, { type Logger } from "pino";
import { createAi, type Ai } from "./ai.ts";
import type { Config } from "./config.ts";
import type { IndexDeps } from "./indexer/index-vault.ts";
import { FsObjectStore, S3ObjectStore, type ObjectStore } from "@lore/ingest";

export const QUEUES = {
  /** One pending and one running index job per vault; extra pushes coalesce. */
  index: "index",
  /** One job per changeset: prepare, lint, review rules, commit. */
  changeset: "changeset",
  /** One job per upload or capture: extract, atomize, validate, hand over as a changeset. */
  ingest: "ingest",
} as const;

export interface IngestJobData {
  itemId: string;
}

export interface ChangesetJobData {
  changesetId: string;
}

/** Published after every index run. Plan 4 subscribes the Desk. */
export const VAULT_INDEXED = "vault.indexed";

export interface IndexJobData {
  vaultId: string;
  reason: "push" | "poll" | "seed" | "reindex";
  before?: string | null;
  after?: string;
}

export interface Runtime {
  config: Config;
  db: Db;
  log: Logger;
  deps: IndexDeps;
  ai: Ai;
  close(): Promise<void>;
}

export function mirrorFor(repository: string): Mirror {
  if (repository.startsWith("local:")) return new Mirror(repository.slice("local:".length));
  throw new Error(`Mirrors for ${repository} arrive with GitHubProvider (Plan 4)`);
}

/**
 * The provider that commits to a vault. `onPush` stands in for the push webhook: a local
 * repository has nobody to call us, so the provider does it after each commit.
 */
export function providerFor(
  repository: string,
  onPush?: (vaultId: string) => Promise<void> | void,
): GitProvider {
  if (repository.startsWith("local:"))
    return new LocalGitProvider(onPush ? { onPush: (e) => onPush(e.vaultId) } : {});
  throw new Error(`Commits to ${repository} arrive with GitHubProvider`);
}

export async function objectStoreFor(config: Config): Promise<ObjectStore> {
  if (config.OBJECT_STORE === "fs") return new FsObjectStore(join(config.DATA_DIR, "objects"));
  const store = new S3ObjectStore({
    endpoint: config.S3_ENDPOINT,
    publicEndpoint: config.S3_PUBLIC_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  });
  // Production buckets are created with the deployment; creating one here is for development.
  if (config.NODE_ENV !== "production") await store.ensureBucket();
  return store;
}

export async function createRuntime(
  config: Config,
  opts: { quiet?: boolean } = {},
): Promise<Runtime> {
  const log = pino({
    level: opts.quiet ? "warn" : config.LOG_LEVEL,
    ...(config.NODE_ENV === "production"
      ? {}
      : { transport: { target: "pino-pretty", options: { colorize: true } } }),
  });
  const db = createDb(config.DATABASE_URL, { max: 5 });
  await migrateDb(db);
  const meili = new Meilisearch({ host: config.MEILI_URL, apiKey: config.MEILI_MASTER_KEY });
  const deps: IndexDeps = {
    db,
    meili,
    mirrorFor,
    embedder: embedderFor(config.EMBEDDINGS, {
      localModel: config.EMBEDDINGS_LOCAL_MODEL,
      cacheDir: config.EMBEDDINGS_CACHE_DIR,
    }),
    objects: await objectStoreFor(config),
    log,
  };
  return {
    config,
    db,
    log,
    deps,
    ai: createAi(config, db),
    async close() {
      await db.$client.end({ timeout: 5 });
      log.flush?.();
    },
  };
}

export async function startBoss(config: Config, log: Logger): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss" });
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();
  await boss.createQueue(QUEUES.index, { policy: "stately", retryLimit: 3, retryDelay: 5 });
  await boss.createQueue(QUEUES.changeset, { retryLimit: 3, retryDelay: 5, retryBackoff: true });
  // Not retried by the queue: a model call that failed is retried by the sweep, later.
  await boss.createQueue(QUEUES.ingest, { retryLimit: 0, expireInSeconds: 900 });
  return boss;
}

export async function enqueueIngest(boss: PgBoss, itemId: string): Promise<void> {
  await boss.send(QUEUES.ingest, { itemId }, { singletonKey: itemId });
}

export async function enqueueChangeset(boss: PgBoss, changesetId: string): Promise<void> {
  // One job per changeset at a time; a second request while it runs is dropped.
  await boss.send(QUEUES.changeset, { changesetId }, { singletonKey: changesetId });
}

export async function enqueueIndex(boss: PgBoss, data: IndexJobData): Promise<void> {
  await boss.send(QUEUES.index, data, { singletonKey: data.vaultId });
}
