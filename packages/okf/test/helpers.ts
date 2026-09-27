import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MemorySource } from "../src/source.ts";
import type { FileOp } from "../src/types.ts";

export const REPO = fileURLToPath(new URL("../../..", import.meta.url));
export const FIXTURES = join(REPO, "fixtures");
export const ACME = join(FIXTURES, "vault-acme");
export const DIRTY = join(FIXTURES, "vault-dirty");
/** The instant every fixture test treats as now. */
export const NOW = new Date("2026-09-24T00:00:00Z");

const BINARY = /\.(png|jpe?g|gif|webp|pdf)$/i;

export function readTree(root: string): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name !== ".DS_Store") {
        const rel = relative(root, full).split(sep).join("/");
        out[rel] = BINARY.test(name)
          ? new Uint8Array(readFileSync(full))
          : readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return out;
}

export function acmeSource(): MemorySource {
  return new MemorySource(readTree(ACME));
}

/** Rule ids that have a vault-dirty case, e.g. `lore/required`. */
export function dirtyRules(): string[] {
  const rules: string[] = [];
  for (const family of readdirSync(DIRTY)) {
    if (family.startsWith("_") || !statSync(join(DIRTY, family)).isDirectory()) continue;
    for (const rule of readdirSync(join(DIRTY, family))) rules.push(`${family}/${rule}`);
  }
  return rules.sort();
}

/** The shared base vault with the case's input files on top. */
export function dirtySource(rule: string): MemorySource {
  return new MemorySource({
    ...readTree(join(DIRTY, "_base")),
    ...readTree(join(DIRTY, rule, "input")),
  });
}

/** Deterministic ids for fixes: kb_01J9ZF followed by a counter. */
export function idCounter(): () => string {
  let n = 0;
  return () => `kb_01J9ZF${String(++n).padStart(20, "0")}`;
}

export function applyOps(src: MemorySource, ops: FileOp[]): MemorySource {
  return src.apply(ops);
}
