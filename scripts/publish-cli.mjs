#!/usr/bin/env node
// Packs packages/cli/dist/kb.js as a standalone npm package and publishes it to GitHub Packages.
//   node scripts/publish-cli.mjs @yourorg/kb [--dry-run]
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [name, ...flags] = process.argv.slice(2);
if (!name || !/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(name)) {
  console.error("usage: node scripts/publish-cli.mjs @scope/name [--dry-run]");
  process.exit(2);
}
const cli = JSON.parse(readFileSync(join(REPO, "packages/cli/package.json"), "utf8"));
execFileSync("pnpm", ["--filter", "@lore/cli", "build"], { cwd: REPO, stdio: "inherit" });
const dir = mkdtempSync(join(tmpdir(), "kb-publish-"));
cpSync(join(REPO, "packages/cli/dist"), join(dir, "dist"), { recursive: true });
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify(
    {
      name,
      version: cli.version,
      description: cli.description,
      type: "module",
      bin: { kb: "dist/kb.js" },
      files: ["dist"],
      engines: { node: ">=24" },
      publishConfig: { registry: "https://npm.pkg.github.com" },
      repository: process.env.GITHUB_REPOSITORY
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
        : undefined,
    },
    null,
    2,
  ),
);
execFileSync("npm", ["publish", ...flags], { cwd: dir, stdio: "inherit" });
