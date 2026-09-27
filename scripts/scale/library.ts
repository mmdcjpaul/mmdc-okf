// Scale check for the Library on the 20,000-note synthetic vault (plans/02-library.md):
//   - a one-note push is searchable in under 30 s (L3 freshness)
//   - search p95 is under 300 ms (L4)
//   - the global graph draws every note without freezing the page (L10)
// Needs the dev services (`pnpm services:up`) and Docker for k6.
//   pnpm scale:library [--keep]
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import postgres from "postgres";
import { createSignIn, sessionCookieFor } from "../../packages/auth/src/sign-in.ts";
import { createDb } from "../../packages/db/src/index.ts";
import { checkGraph } from "./graph-check.ts";

const REPO = resolve(import.meta.dirname, "../..");
const VAULT_DIR = join(REPO, "bench-out/synthetic-vault");
const DATA_DIR = join(tmpdir(), "lore-scale-data");
const WEB_ENV = join(DATA_DIR, "web.env");
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgres://lore:lore@127.0.0.1:5433/lore";
const PORT = 3200;
const keep = process.argv.includes("--keep");

const env = {
  ...process.env,
  DATABASE_URL: ADMIN_URL.replace(/\/[^/]+$/, "/lore_scale"),
  DATA_DIR,
  S3_BUCKET: "lore-scale",
  EMBEDDINGS: "hash",
  LOG_LEVEL: "warn",
};
const lore = (...args: string[]) =>
  execFileSync(process.execPath, [join(REPO, "apps/worker/src/cli.ts"), ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

const results: { step: string; value: string; limit: string; ok: boolean }[] = [];
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

if (!existsSync(join(VAULT_DIR, ".kb/profile.yaml"))) {
  execFileSync(
    process.execPath,
    [join(REPO, "scripts/gen-synthetic-vault.ts"), VAULT_DIR, "20000"],
    { stdio: "inherit" },
  );
}

// 1. A full index from nothing.
rmSync(DATA_DIR, { recursive: true, force: true });
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
await admin.unsafe("drop database if exists lore_scale with (force)");
await admin.unsafe("create database lore_scale");
await admin.end();
let t0 = performance.now();
console.log(
  lore(
    "seed",
    "--vault",
    VAULT_DIR,
    "--principals",
    join(REPO, "fixtures/principals.yaml"),
    "--slug",
    "synthetic",
    "--fresh",
    "--web-env",
    WEB_ENV,
  ).trim(),
);
results.push({
  step: "full index, 20,000 notes",
  value: seconds(performance.now() - t0),
  limit: "-",
  ok: true,
});

// 2. One note pushed from outside, then indexed.
const work = mkdtempSync(join(tmpdir(), "lore-scale-push-"));
const git = (...args: string[]) =>
  execFileSync("git", ["-C", work, ...args], { encoding: "utf8", stdio: "pipe" });
execFileSync("git", ["clone", "--quiet", join(DATA_DIR, "vaults/synthetic.git"), work]);
const note = git("ls-files", "kb/*/note-*.md").split("\n")[0]!;
appendFileSync(join(work, note), "\nA line added by the scale check.\n");
git("-c", "user.name=Scale", "-c", "user.email=scale@lore.local", "commit", "-qam", "edit");
git("push", "--quiet", "origin", "main");
rmSync(work, { recursive: true, force: true });
t0 = performance.now();
console.log(lore("reindex", "--vault", "synthetic").trim());
const push = performance.now() - t0;
results.push({
  step: "one-note push to searchable",
  value: seconds(push),
  limit: "30 s",
  ok: push < 30_000,
});

// 3. Search under load, against a production build.
const fileEnv = Object.fromEntries(
  readFileSync(WEB_ENV, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const webEnv = {
  ...process.env,
  ...fileEnv,
  AUTH_DEV_LOGIN: "false",
  AUTH_ALLOWED_DOMAINS: "acme.test",
  PUBLIC_URL: `http://127.0.0.1:${PORT}`,
  INTERNAL_API_TOKEN: "lore-scale-internal-token",
  NEXT_DIST_DIR: ".next-scale",
  NEXT_TELEMETRY_DISABLED: "1",
};
const web = join(REPO, "apps/web");
execFileSync("pnpm", ["exec", "next", "build"], { cwd: web, env: webEnv, stdio: "inherit" });
const server: ChildProcess = spawn("pnpm", ["exec", "next", "start", "--port", String(PORT)], {
  cwd: web,
  env: webEnv,
  stdio: "ignore",
});
let k6Status: number;

try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  // The app under test is a production build, which has no dev login. A session is made
  // for it here, with the same database and secret.
  const scaleDb = createDb(env.DATABASE_URL, { max: 1 });
  const session = await sessionCookieFor(
    createSignIn({
      db: scaleDb,
      secret: fileEnv.APP_SECRET!,
      baseURL: webEnv.PUBLIC_URL,
      allowedDomains: ["acme.test"],
      devLogin: true,
      production: false,
    }),
    "alice",
  );
  await scaleDb.$client.end({ timeout: 5 });
  const summary = join(DATA_DIR, "k6-summary.json");
  const k6 = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--add-host=host.docker.internal:host-gateway",
      "-v",
      `${join(REPO, "scripts/scale")}:/scripts:ro`,
      "-v",
      `${DATA_DIR}:/out`,
      "-e",
      `BASE_URL=http://host.docker.internal:${PORT}`,
      "-e",
      `SESSION=${session}`,
      "grafana/k6:1.3.0",
      "run",
      "--quiet",
      "--summary-export=/out/k6-summary.json",
      "/scripts/search.k6.js",
    ],
    { stdio: "inherit" },
  );
  k6Status = k6.status ?? 1;
  results.push(...(await checkGraph(`http://127.0.0.1:${PORT}`, session)));
  if (existsSync(summary)) {
    const metrics = JSON.parse(readFileSync(summary, "utf8")).metrics as Record<
      string,
      Record<string, number>
    >;
    for (const kind of ["palette", "page"]) {
      const p95 = metrics[`http_req_duration{kind:${kind}}`]?.["p(95)"];
      if (p95 === undefined) continue;
      results.push({
        step: `search p95, ${kind === "palette" ? "Cmd-K endpoint" : "results page"}`,
        value: `${Math.round(p95)} ms`,
        limit: "300 ms",
        ok: p95 < 300,
      });
    }
  }
} finally {
  server.kill("SIGTERM");
  rmSync(join(web, ".next-scale"), { recursive: true, force: true });
}

console.table(results.map((r) => ({ ...r, ok: r.ok ? "yes" : "NO" })));
if (!keep) {
  const cleanup = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await cleanup.unsafe("drop database if exists lore_scale with (force)");
  await cleanup.end();
  rmSync(DATA_DIR, { recursive: true, force: true });
}
if (k6Status !== 0 || results.some((r) => !r.ok)) process.exitCode = 1;
