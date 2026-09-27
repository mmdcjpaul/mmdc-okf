import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiskSource, lint, loadVault } from "@lore/okf";

const REPO = resolve(import.meta.dirname, "../../..");
const PATCHES = join(REPO, "fixtures/patches");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-patch-"));
  cpSync(join(REPO, "fixtures/vault-acme"), dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Patches for `lore simulate-push --file`; they must keep applying as the fixture changes. */
describe("fixtures/patches", () => {
  const patches = readdirSync(PATCHES).filter((f) => f.endsWith(".patch"));

  it("has the patch the Library plan uses", () => {
    expect(patches).toContain("obsidian-edit.patch");
  });

  it.each(patches)("%s applies to vault-acme and leaves it lint-clean", async (patch) => {
    execFileSync("git", ["apply", join(PATCHES, patch)], { cwd: dir });
    const report = await lint(await loadVault(new DiskSource(dir)), {
      now: new Date("2026-09-24T00:00:00Z"),
    });
    expect(report.errors).toBe(0);
  });
});
