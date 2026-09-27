/**
 * Builds the world the suite runs in: a fresh database, the Acme fixture vault in a bare
 * repository, its principals, and a full index. Runs before the worker starts.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { DATA_DIR, PG_ADMIN_URL, REPO, VAULT, WEB_ENV_FILE, WORKER_ENV } from "./env.ts";

rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });

const admin = postgres(PG_ADMIN_URL, { max: 1, onnotice: () => {} });
await admin.unsafe("drop database if exists lore_e2e with (force)");
await admin.unsafe("create database lore_e2e");
await admin.end();

execFileSync(
  process.execPath,
  [
    join(REPO, "apps/worker/src/cli.ts"),
    "seed",
    "--vault",
    join(REPO, "fixtures/vault-acme"),
    "--principals",
    join(REPO, "fixtures/principals.yaml"),
    "--slug",
    VAULT,
    "--fresh",
    "--web-env",
    WEB_ENV_FILE,
  ],
  { env: { ...process.env, ...WORKER_ENV }, stdio: "inherit" },
);
