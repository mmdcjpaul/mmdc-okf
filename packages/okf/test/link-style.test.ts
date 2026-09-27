import { describe, expect, it } from "vitest";
import { generateIndexes } from "../src/indexes.ts";
import { fix, lint } from "../src/lint/index.ts";
import { loadVault } from "../src/vault.ts";
import { acmeSource, NOW } from "./helpers.ts";

describe("switching link_style", () => {
  it("converts every link in vault-acme to relative with lint --fix, and the result still resolves", async () => {
    let src = acmeSource();
    const profile = (await src.read(".kb/profile.yaml")) as string;
    src.files.set(
      ".kb/profile.yaml",
      profile.replace("link_style: absolute", "link_style: relative"),
    );
    let vault = await loadVault(src);
    const report = await lint(vault, { now: NOW });
    expect(report.issues.filter((i) => i.rule === "lore/link-style").length).toBeGreaterThan(80);

    src = src.apply(await fix(vault, report, { now: NOW }));
    src = src.apply(await generateIndexes(await loadVault(src), { now: NOW }));
    vault = await loadVault(src);
    const after = await lint(vault, { now: NOW });
    expect(after.issues.filter((i) => i.rule === "lore/link-style")).toEqual([]);
    expect(after.errors).toBe(0);
    // Still exactly one wanted note: nothing broke in the conversion.
    expect(after.issues.filter((i) => i.rule === "lore/link-targets")).toHaveLength(1);
    expect(src.files.get("kb/admissions/enroll-a-new-student.md")).toContain(
      "[Enroll a returning student in Salesforce](./enroll-a-returning-student-in-salesforce.md)",
    );
    expect(src.files.get("kb/index.md")).toContain("* [Admissions](./admissions/index.md)");
  });
});
