// Scale benchmark: lint, index, and query timings on the 20,000-note synthetic vault.
//   pnpm --filter @lore/okf bench            (generates the vault on first run)
// Targets (Plan 1): lint < 30 s, index < 60 s, warm query < 200 ms.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DiskSource, generateIndexes, lint, loadVault, OverlaySource } from "../../src/index.ts";

const REPO = fileURLToPath(new URL("../../../..", import.meta.url));
const VAULT = join(REPO, "bench-out/synthetic-vault");
const COUNT = Number(process.env.BENCH_NOTES ?? 20000);

if (!existsSync(join(VAULT, ".kb/profile.yaml"))) {
  execFileSync(
    process.execPath,
    [join(REPO, "scripts/gen-synthetic-vault.ts"), VAULT, String(COUNT)],
    { stdio: "inherit" },
  );
}

const results: { step: string; ms: number; limit: number }[] = [];
const time = async <T>(step: string, limit: number, fn: () => Promise<T> | T): Promise<T> => {
  const t0 = performance.now();
  const r = await fn();
  results.push({ step, ms: Math.round(performance.now() - t0), limit });
  return r;
};

const vault = await time("load vault", Infinity, () => loadVault(new DiskSource(VAULT)));
const report = await time("lint (incl. load)", 30_000, async () =>
  lint(await loadVault(new DiskSource(VAULT))),
);
console.log(`lint: ${report.checked} notes, ${report.errors} errors, ${report.warnings} warnings`);
const ops = await time("index (incl. load)", 60_000, async () =>
  generateIndexes(await loadVault(new DiskSource(VAULT))),
);
console.log(`index: ${ops.length} files to write`);
const second = await loadVault(new OverlaySource(new DiskSource(VAULT), ops));
void vault;
void second;

const kb = join(REPO, "packages/cli/dist/kb.js");
if (existsSync(kb)) {
  const query = (label: string, limit: number) =>
    time(label, limit, () =>
      spawnSync(process.execPath, [kb, "query", "review payment ledger", "--limit", "5"], {
        cwd: VAULT,
        encoding: "utf8",
      }),
    );
  spawnSync("rm", ["-rf", join(VAULT, ".kb/.cache")]);
  await query("kb query, cold cache (process)", Infinity);
  await query("kb query, warm cache (process)", Infinity);
  // The 200 ms target is the query itself (open the cached index, check freshness, search),
  // timed in a fresh process so Node start-up and module loading are excluded.
  const probe = `
    const { openIndex, search } = await import(${JSON.stringify(join(REPO, "packages/cli/src/search.ts"))});
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      search(openIndex(${JSON.stringify(VAULT)}, "kb").index, "review payment ledger", { limit: 5 });
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    console.log(JSON.stringify({ first: runs[0], median: runs[2] }));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8" });
  const { median } = JSON.parse(r.stdout.trim().split("\n").pop()!);
  results.push({
    step: "query, warm cache (median of 5, in process)",
    ms: Math.round(median),
    limit: 200,
  });
}

console.table(
  results.map((r) => ({
    ...r,
    limit: Number.isFinite(r.limit) ? r.limit : "-",
    ok: r.ms <= r.limit ? "yes" : "NO",
  })),
);
if (results.some((r) => r.ms > r.limit)) process.exitCode = 1;
