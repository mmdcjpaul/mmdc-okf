/**
 * Settings for the standalone end-to-end suite (plans/02-library.md, section 5). It runs the
 * real web app and worker against their own database, search indexes, bucket, and bare
 * repository, so it never touches the data of a developer's running Library.
 */
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dirname, "../../..");
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const WORKER_PORT = Number(process.env.E2E_WORKER_PORT ?? 8181);
// `localhost`, not 127.0.0.1: the Next dev server only serves its scripts to its own origin.
export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const VAULT = "acme-e2e";
export const DATA_DIR = process.env.E2E_DATA_DIR ?? join(tmpdir(), "lore-e2e-data");
export const WEB_ENV_FILE = join(DATA_DIR, "web.env");

const PG = process.env.TEST_PG_ADMIN_URL ?? "postgres://lore:lore@127.0.0.1:5433/lore";
export const PG_ADMIN_URL = PG;
export const DATABASE_URL = PG.replace(/\/[^/]+$/, "/lore_e2e");

/** Environment for the worker and the `lore` CLI. */
export const WORKER_ENV: Record<string, string> = {
  NODE_ENV: "development",
  DATABASE_URL,
  MEILI_URL: process.env.TEST_MEILI_URL ?? "http://127.0.0.1:7701",
  MEILI_MASTER_KEY: process.env.TEST_MEILI_KEY ?? "lore-dev-master-key",
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9002",
  S3_BUCKET: "lore-e2e",
  DATA_DIR,
  EMBEDDINGS: "hash",
  AI_MODE: "fake",
  GIT_PROVIDER: "local",
  WORKER_PORT: String(WORKER_PORT),
  INTERNAL_API_TOKEN: "lore-e2e-internal-token",
  // A throwaway key: the suite saves provider keys to check they never come back.
  APP_ENCRYPTION_KEY: "e2e0".repeat(16),
  LOG_LEVEL: "warn",
  // Pushes are indexed inline by the tests; the poller only needs to exist.
  POLL_SECONDS: "3600",
};
