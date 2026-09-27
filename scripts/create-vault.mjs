#!/usr/bin/env node
// Creates a new vault repository from templates/vault.
//   pnpm create-vault <name> [--dir <path>] [--title "<title>"] [--cli @yourorg/kb@1] [--no-git]
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DiskSource, fix, generateIndexes, lint, loadVault } from "../packages/okf/src/index.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(REPO, "templates/vault");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    title: { type: "string" },
    cli: { type: "string", default: "@yourorg/kb@1" },
    "no-git": { type: "boolean", default: false },
  },
});

const name = positionals[0];
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(
    "usage: pnpm create-vault <name> [--dir <path>] [--title <title>] [--cli <package@major>] [--no-git]",
  );
  process.exit(2);
}
const target = resolve(values.dir ?? join(process.cwd(), name));
if (existsSync(target) && readdirSync(target).length) {
  console.error(`${target} exists and is not empty`);
  process.exit(2);
}

const cliPackage = values.cli;
const scope = cliPackage.startsWith("@") ? cliPackage.split("/")[0] : "";
const title = values.title ?? name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const today = new Date().toISOString().slice(0, 10);
const replacements = {
  "{{VAULT_TITLE}}": title,
  "{{CLI_PACKAGE}}": cliPackage,
  "{{CLI_SCOPE}}": scope,
  "{{TODAY}}": today,
};

mkdirSync(target, { recursive: true });
cpSync(TEMPLATE, target, { recursive: true, verbatimSymlinks: true });
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(full);
    else if (/\.(md|ya?ml|json)$/.test(entry) || entry === ".gitignore") {
      let text = readFileSync(full, "utf8");
      for (const [k, v] of Object.entries(replacements)) text = text.split(k).join(v);
      writeFileSync(full, text);
    }
  }
};
walk(target);

const apply = (ops) => {
  for (const op of ops) {
    const full = join(target, op.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, op.content);
  }
};

// Template notes carry no ids so every vault gets its own: the linter's fix adds them.
let vault = await loadVault(new DiskSource(target));
apply(await fix(vault, await lint(vault)));
vault = await loadVault(new DiskSource(target));
apply(await generateIndexes(vault));
vault = await loadVault(new DiskSource(target));
const report = await lint(vault);
if (report.errors) {
  console.error(`The new vault has ${report.errors} lint errors; the template needs fixing.`);
  process.exit(1);
}

if (!values["no-git"]) {
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: target, stdio: "ignore" });
  } catch {
    console.warn("git init failed; initialise the repository yourself.");
  }
}

console.log(`Created ${title} in ${target}

Next steps:
  cd ${target}
  node ${join(REPO, "packages/cli/dist/kb.js")} lint     # or: npx -y ${cliPackage} lint
  Edit .kb/namespaces.yaml, .kb/tags.yaml, and the hubs in kb/_themes and kb/_systems.
  Commit, push to GitHub, and the kb workflow lints every change and regenerates indexes.`);
