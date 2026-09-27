import { join } from "node:path";
import { embedderFor } from "@lore/ai";
import { createDb, listVaults, type Db } from "@lore/db";
import { migrateDb } from "@lore/db/migrate";
import type { GitHubAuth } from "@lore/git/github";
import { Meilisearch } from "@lore/search";
import { PgBoss } from "pg-boss";
import pino, { type Logger } from "pino";
import { createAi, type Ai } from "./ai.ts";
import type { Config } from "./config.ts";
import { mirrorFor, setupGit, syncMirror } from "./git.ts";
import type { IndexDeps } from "./indexer/index-vault.ts";
import { FsObjectStore, S3ObjectStore, type ObjectStore } from "@lore/ingest";

export const QUEUES = {
  /** One pending and one running index job per vault; extra pushes coalesce. */
  index: "index",
  /** One job per changeset: prepare, lint, review rules, commit. */
  changeset: "changeset",
  /** One job per upload or capture: extract, atomize, validate, hand over as a changeset. */
  ingest: "ingest",
  /** The weekly owner digest, on a schedule. */
  digest: "digest",
  /** A Gardener run: weekly for every vault, or asked for from the Hygiene page. */
  gardener: "gardener",
} as const;

export interface IngestJobData {
  itemId: string;
  /** `batch` lets the item's model calls wait for a batch. Process now is `now`. */
  mode?: "now" | "batch";
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

export { mirrorFor, providerFor, syncMirror } from "./git.ts";

function githubAuth(config: Config): GitHubAuth | null {
  if (config.GITHUB_APP_ID && config.GITHUB_APP_PRIVATE_KEY && config.GITHUB_INSTALLATION_ID)
    return {
      appId: config.GITHUB_APP_ID,
      // Environment files hold the key on one line, with `\n` for the line breaks.
      privateKey: config.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
      installationId: config.GITHUB_INSTALLATION_ID,
    };
  return config.GITHUB_TOKEN ? { token: config.GITHUB_TOKEN } : null;
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
  setupGit({
    dataDir: config.DATA_DIR,
    ...(githubAuth(config)
      ? {
          github: {
            auth: githubAuth(config)!,
            apiUrl: config.GITHUB_API_URL,
            gitUrl: config.GITHUB_GIT_URL,
            webhookSecret: config.GITHUB_WEBHOOK_SECRET,
          },
        }
      : {}),
    vaultFor: async (repository, branch) =>
      (await listVaults(db)).find((v) => v.repository === repository && v.branch === branch)?.id ??
      null,
  });
  const meili = new Meilisearch({ host: config.MEILI_URL, apiKey: config.MEILI_MASTER_KEY });
  const deps: IndexDeps = {
    db,
    meili,
    mirrorFor,
    syncMirror,
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
  await boss.createQueue(QUEUES.digest, { policy: "stately", retryLimit: 2, retryDelay: 600 });
  await boss.createQueue(QUEUES.gardener, { retryLimit: 0, expireInSeconds: 1800 });
  // Sunday night, so Monday's digest and review queue have what it found.
  await boss.schedule(QUEUES.gardener, "0 22 * * 0", {}, { tz: config.TIME_ZONE });
  // Monday morning, in the organization's time zone.
  await boss.schedule(QUEUES.digest, "0 8 * * 1", {}, { tz: config.TIME_ZONE });
  return boss;
}

export interface GardenerJobData {
  /** Missing on the weekly schedule, which runs every vault. */
  vaultId?: string;
  namespace?: string | null;
  requestedBy?: string | null;
}

export async function enqueueGardener(boss: PgBoss, data: GardenerJobData): Promise<void> {
  // One waiting run per vault and namespace: asking twice does not run it twice.
  await boss.send(QUEUES.gardener, data, {
    singletonKey: `${data.vaultId ?? "all"}:${data.namespace ?? ""}`,
  });
}

export async function enqueueIngest(
  boss: PgBoss,
  itemId: string,
  mode: "now" | "batch" = "now",
): Promise<void> {
  await boss.send(QUEUES.ingest, { itemId, mode }, { singletonKey: itemId });
}

export async function enqueueChangeset(boss: PgBoss, changesetId: string): Promise<void> {
  // One job per changeset at a time; a second request while it runs is dropped.
  await boss.send(QUEUES.changeset, { changesetId }, { singletonKey: changesetId });
}

export async function enqueueIndex(boss: PgBoss, data: IndexJobData): Promise<void> {
  await boss.send(QUEUES.index, data, { singletonKey: data.vaultId });
}
