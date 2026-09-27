// Regenerates golden files. Review the diff before committing: goldens are the spec.
//   node packages/okf/test/update-goldens.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chunkNote } from "../src/chunk.ts";
import { fix, lint } from "../src/lint/index.ts";
import { loadVault } from "../src/vault.ts";
import { acmeSource, DIRTY, dirtyRules, dirtySource, idCounter, NOW } from "./helpers.ts";
import { CHUNK_GOLDEN_NOTES, GOLDEN_DIR } from "./golden-notes.ts";

for (const rule of dirtyRules()) {
  const src = dirtySource(rule);
  const vault = await loadVault(src);
  const report = await lint(vault, { now: NOW });
  const issues = report.issues.filter((i) => i.rule === rule);
  const dir = join(DIRTY, rule);
  writeFileSync(join(dir, "expected-issues.json"), JSON.stringify(issues, null, 2) + "\n");
  rmSync(join(dir, "expected"), { recursive: true, force: true });
  const ops = await fix(vault, { ...report, issues }, { now: NOW, newId: idCounter() });
  for (const op of ops) {
    const full = join(dir, "expected", op.op === "put" ? op.path : op.path + ".deleted");
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, op.op === "put" ? op.content : "");
  }
  console.log(`${rule}: ${issues.length} issues, ${ops.length} fix ops`);
}

const acme = await loadVault(acmeSource());
rmSync(GOLDEN_DIR, { recursive: true, force: true });
mkdirSync(GOLDEN_DIR, { recursive: true });
for (const path of CHUNK_GOLDEN_NOTES) {
  const chunks = chunkNote(acme.notes.get(path)!, acme);
  writeFileSync(
    join(GOLDEN_DIR, path.replace(/\//g, "__") + ".chunks.json"),
    JSON.stringify(chunks, null, 2) + "\n",
  );
}
console.log(`chunk goldens: ${CHUNK_GOLDEN_NOTES.length}`);
