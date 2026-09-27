/**
 * `pnpm lore <command>`: local operations for the Library.
 *
 *   seed --vault <dir> [--principals <yaml>] [--slug <slug>] [--fresh] [--web-env <file|none>]
 *       Create (or update) the bare repository from a vault folder, register the vault,
 *       load users, teams, and grants, and run a full index.
 *   reindex [--vault <slug>] [--all]
 *       Index new commits now. --all clears the vault's rows and search indexes first.
 *   simulate-push --vault <slug> (--file <patch> | --from <dir>) [--message <text>] [--now]
 *       Commit to the bare repository from outside Lore, the way Obsidian or an agent would,
 *       then queue an index job (or run it inline with --now).
 *   migrate
 *       Apply database migrations.
 */
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  clearVaultIndex,
  getVaultBySlug,
  listVaults,
  seedPrincipals,
  upsertVault,
  type Vault,
} from "@lore/db";
import { commitWorkingTree, initBareRepo } from "@lore/git";
import { dropIndexes, Meilisearch } from "@lore/search";
import { parse as parseYaml } from "yaml";
import { loadConfig, type Config } from "./config.ts";
import { loadPrincipals } from "./principals.ts";
import { indexVault, type IndexResult } from "./indexer/index-vault.ts";
import { createRuntime, enqueueIndex, startBoss, type Runtime } from "./runtime.ts";

const [command, ...rest] = process.argv.slice(2);
const config = loadConfig();

function fail(message: string): never {
  console.error(`lore: ${message}`);
  process.exit(1);
}

function slugFromDir(dir: string): string {
  return basename(resolve(dir))
    .replace(/^vault-/, "")
    .replace(/-vault$/, "")
    .toLowerCase();
}

function repoPathFor(slug: string): string {
  return join(config.DATA_DIR, "vaults", `${slug}.git`);
}

/** True when `dir` is the root of its own repository and has commits. */
function hasCommits(dir: string): boolean {
  try {
    const opts: ExecFileSyncOptionsWithStringEncoding = {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    };
    // A vault folder inside another repository (a fixture, say) has no history of its own.
    const top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], opts).trim();
    if (realpathSync(top) !== realpathSync(dir)) return false;
    execFileSync("git", ["-C", dir, "rev-parse", "--verify", "--quiet", "HEAD"], opts);
    return true;
  } catch {
    return false;
  }
}

/** Writes the web app's local env file, including Meilisearch's search-only key. */
async function writeWebEnv(cfg: Config, slug: string, file: string): Promise<void> {
  const meili = new Meilisearch({ host: cfg.MEILI_URL, apiKey: cfg.MEILI_MASTER_KEY });
  const keys = await meili.getKeys();
  const search = keys.results.find((k) => k.actions.length === 1 && k.actions[0] === "search");
  if (!search) fail("Meilisearch has no search-only key");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const secret = /^APP_SECRET=(.+)$/m.exec(existing)?.[1] ?? crypto.randomUUID().replace(/-/g, "");
  writeFileSync(
    file,
    [
      "# Written by `pnpm lore seed`. Local development only.",
      `DATABASE_URL=${cfg.DATABASE_URL}`,
      `MEILI_URL=${cfg.MEILI_URL}`,
      `MEILI_SEARCH_KEY=${search.key}`,
      `S3_ENDPOINT=${cfg.S3_PUBLIC_ENDPOINT ?? cfg.S3_ENDPOINT}`,
      `S3_REGION=${cfg.S3_REGION}`,
      `S3_BUCKET=${cfg.S3_BUCKET}`,
      `S3_ACCESS_KEY_ID=${cfg.S3_ACCESS_KEY_ID}`,
      `S3_SECRET_ACCESS_KEY=${cfg.S3_SECRET_ACCESS_KEY}`,
      `WORKER_URL=http://${cfg.WORKER_HOST}:${cfg.WORKER_PORT}`,
      `INTERNAL_API_TOKEN=${cfg.INTERNAL_API_TOKEN}`,
      `LORE_VAULT=${slug}`,
      `APP_SECRET=${secret}`,
      "AUTH_DEV_LOGIN=true",
      `EMBEDDINGS=${cfg.EMBEDDINGS}`,
      "FEATURE_DESK=false",
      "",
    ].join("\n"),
  );
}

function summary(r: IndexResult): string {
  if (r.skipped) return `already at ${r.head?.slice(0, 8) ?? "(empty)"}`;
  return `${r.notes} notes, ${r.changed.length} written, ${r.deleted.length} removed, ${r.embedded} embedded, head ${r.head?.slice(0, 8)}`;
}

async function withRuntime<T>(fn: (rt: Runtime) => Promise<T>): Promise<T> {
  const rt = await createRuntime(config, { quiet: true });
  try {
    return await fn(rt);
  } finally {
    await rt.close();
  }
}

async function seed(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      vault: { type: "string" },
      principals: { type: "string" },
      slug: { type: "string" },
      title: { type: "string" },
      branch: { type: "string", default: "main" },
      fresh: { type: "boolean", default: false },
      "web-env": { type: "string" },
    },
  });
  if (!values.vault) fail("seed needs --vault <dir>");
  const dir = resolve(values.vault);
  if (!existsSync(join(dir, ".kb"))) fail(`${dir} has no .kb/ folder; is it a vault?`);
  const slug = values.slug ?? slugFromDir(dir);
  const bare = repoPathFor(slug);
  const branch = values.branch!;

  await withRuntime(async (rt) => {
    const vaultRow = {
      id: slug,
      slug,
      title: values.title ?? slug,
      repository: `local:${bare}`,
      branch,
      bundleRoot: "kb",
    };
    if (values.fresh) {
      rmSync(bare, { recursive: true, force: true });
      await clearVaultIndex(rt.db, slug).catch(() => {});
      await dropIndexes(rt.deps.meili, slug);
    }
    if (!existsSync(bare)) {
      await initBareRepo(bare, branch);
      if (hasCommits(dir)) {
        execFileSync("git", ["-C", dir, "push", "--quiet", bare, `HEAD:refs/heads/${branch}`]);
        console.log(`Pushed ${dir} history to ${bare}`);
      }
    }
    const sha = await commitWorkingTree(
      bare,
      dir,
      branch,
      `Import vault from ${basename(dir)}\n\nSource: lore seed\n`,
    );
    if (sha) console.log(`Committed working files as ${sha.slice(0, 8)}`);

    // The profile title makes a better vault name than the folder.
    const profile = parseYaml(
      execFileSync("git", ["--git-dir", bare, "show", `${branch}:.kb/profile.yaml`], {
        encoding: "utf8",
      }),
    ) as {
      title?: string;
      bundle_root?: string;
    };
    vaultRow.title = values.title ?? profile.title ?? slug;
    vaultRow.bundleRoot = profile.bundle_root ?? "kb";
    await upsertVault(rt.db, vaultRow);

    if (values.principals) {
      await seedPrincipals(rt.db, slug, loadPrincipals(resolve(values.principals)));
      console.log(`Loaded principals from ${values.principals}`);
    }
    const result = await indexVault(rt.deps, slug);
    console.log(`Indexed ${slug}: ${summary(result)}`);
    const webEnv = values["web-env"] ?? join(config.repoRoot, "apps/web/.env.local");
    if (webEnv !== "none") {
      await writeWebEnv(config, slug, resolve(webEnv));
      console.log(`Wrote ${webEnv} (LORE_VAULT=${slug})`);
    }
  });
}

async function vaultsFor(rt: Runtime, slug: string | undefined): Promise<Vault[]> {
  if (!slug) return listVaults(rt.db);
  const v = await getVaultBySlug(rt.db, slug);
  if (!v) fail(`no vault ${slug}`);
  return [v];
}

async function reindex(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { vault: { type: "string" }, all: { type: "boolean", default: false } },
  });
  await withRuntime(async (rt) => {
    for (const v of await vaultsFor(rt, values.vault)) {
      if (values.all) {
        await clearVaultIndex(rt.db, v.id);
        await dropIndexes(rt.deps.meili, v.slug);
      }
      console.log(`Indexed ${v.slug}: ${summary(await indexVault(rt.deps, v.id))}`);
    }
  });
}

async function simulatePush(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      vault: { type: "string" },
      file: { type: "string" },
      from: { type: "string" },
      message: { type: "string" },
      now: { type: "boolean", default: false },
    },
  });
  await withRuntime(async (rt) => {
    const vaults = await vaultsFor(rt, values.vault);
    if (vaults.length !== 1) fail("simulate-push needs --vault <slug> when several vaults exist");
    const v = vaults[0]!;
    const bare = v.repository.replace(/^local:/, "");
    let sha: string | null = null;
    if (values.from) {
      sha = await commitWorkingTree(
        bare,
        values.from,
        v.branch,
        values.message ?? `Edit from ${basename(resolve(values.from))}`,
        {
          name: "External editor",
          email: "external@lore.local",
        },
      );
    } else if (values.file) {
      const work = mkdtempSync(join(tmpdir(), "lore-push-"));
      try {
        const run = (...a: string[]) =>
          execFileSync("git", ["-C", work, ...a], { encoding: "utf8" });
        execFileSync("git", ["clone", "--quiet", "--branch", v.branch, bare, work]);
        run(
          "-c",
          "user.name=External editor",
          "-c",
          "user.email=external@lore.local",
          "apply",
          "--index",
          resolve(values.file),
        );
        run(
          "-c",
          "user.name=External editor",
          "-c",
          "user.email=external@lore.local",
          "commit",
          "--quiet",
          "-m",
          values.message ?? `Apply ${basename(values.file)}`,
        );
        run("push", "--quiet", "origin", v.branch);
        sha = run("rev-parse", "HEAD").trim();
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    } else {
      fail("simulate-push needs --file <patch> or --from <dir>");
    }
    if (!sha) {
      console.log("No changes to push");
      return;
    }
    console.log(`Pushed ${sha.slice(0, 8)} to ${v.slug}`);
    if (values.now) {
      console.log(`Indexed ${v.slug}: ${summary(await indexVault(rt.deps, v.id))}`);
    } else {
      const boss = await startBoss(config, rt.log);
      await enqueueIndex(boss, { vaultId: v.id, reason: "push", after: sha });
      await boss.stop({ graceful: false });
      console.log("Queued an index job; the worker picks it up (pnpm dev:worker)");
    }
  });
}

switch (command) {
  case "seed":
    await seed(rest);
    break;
  case "reindex":
    await reindex(rest);
    break;
  case "simulate-push":
    await simulatePush(rest);
    break;
  case "migrate":
    await withRuntime(async () => console.log("Migrations applied"));
    break;
  default:
    console.error(
      "Usage: lore <seed|reindex|simulate-push|migrate> [options]. See apps/worker/src/cli.ts.",
    );
    process.exit(command ? 1 : 0);
}
