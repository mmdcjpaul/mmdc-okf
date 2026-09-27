import { join } from "node:path";
import { embedderFor } from "@lore/ai";
import { createDb, type Db } from "@lore/db";
import { migrateDb } from "@lore/db/migrate";
import { Mirror } from "@lore/git";
import { Meilisearch } from "@lore/search";
import { PgBoss } from "pg-boss";
import pino, { type Logger } from "pino";
import type { Config } from "./config.ts";
import type { IndexDeps } from "./indexer/index-vault.ts";
import { FsObjectStore, S3ObjectStore, type ObjectStore } from "@lore/ingest";

export const QUEUES = {
  /** One pending and one running index job per vault; extra pushes coalesce. */
  index: "index",
} as const;

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
  close(): Promise<void>;
}

export function mirrorFor(repository: string): Mirror {
  if (repository.startsWith("local:")) return new Mirror(repository.slice("local:".length));
  throw new Error(`Mirrors for ${repository} arrive with GitHubProvider (Plan 4)`);
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
  return boss;
}

export async function enqueueIndex(boss: PgBoss, data: IndexJobData): Promise<void> {
  await boss.send(QUEUES.index, data, { singletonKey: data.vaultId });
}
