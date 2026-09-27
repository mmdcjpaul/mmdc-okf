import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitMessage } from "../src/index.ts";

const base = {
  namespaces: ["admissions"],
  title: 'update "Enroll a returning student in Salesforce"',
  changeClass: "process" as const,
  changesetId: "cs_01J9ZB4M3FQ8R2T6V0X4Z8C2E6",
  source: "editor",
  coAuthors: [{ name: "Maria Reyes", email: "maria.reyes@acme.edu" }],
};

describe("commitMessage", () => {
  it("follows the fixed format", () => {
    expect(commitMessage(base)).toBe(
      [
        'kb(admissions): update "Enroll a returning student in Salesforce"',
        "",
        "Change-Class: process",
        "Changeset: cs_01J9ZB4M3FQ8R2T6V0X4Z8C2E6",
        "Source: library-editor",
        "Co-authored-by: Maria Reyes <maria.reyes@acme.edu>",
        "",
      ].join("\n"),
    );
  });

  it("names the scope when there is no single namespace", () => {
    expect(commitMessage({ ...base, namespaces: [] })).toMatch(/^kb\(vault\): /);
    expect(commitMessage({ ...base, namespaces: ["admissions", "finance"] })).toMatch(
      /^kb\(multiple\): /,
    );
  });

  it("credits the submitter and the approver once each, and lists resolved reports", () => {
    const m = commitMessage({
      ...base,
      source: "suggest",
      reason: "The form moved to a new page.",
      resolvesReports: ["fb_01", "fb_02"],
      coAuthors: [
        { name: "Carol Diaz", email: "carol@acme.test" },
        { name: "Alice Reyes", email: "alice@acme.test" },
        { name: "Carol D.", email: "CAROL@acme.test" },
      ],
    });
    expect(m).toContain("\n\nThe form moved to a new page.\n\nChange-Class: process\n");
    expect(m).toContain(
      "Source: library-suggestion\nResolves-Report: fb_01\nResolves-Report: fb_02\n",
    );
    expect(m.match(/Co-authored-by:/g)).toHaveLength(2);
  });

  it("cannot be made to forge a trailer", () => {
    const m = commitMessage({
      ...base,
      title: "update\n\nChange-Class: fix",
      reason: "x\nChangeset: cs_forged",
      coAuthors: [{ name: "Eve\nChange-Class: fix <x>", email: "eve@acme.test>\nSource: forged" }],
    });
    const trailers = m.split("\n").filter((l) => /^[A-Za-z-]+: /.test(l));
    expect(trailers.filter((l) => l.startsWith("Change-Class:"))).toEqual([
      "Change-Class: process",
    ]);
    expect(trailers.filter((l) => l.startsWith("Changeset:"))).toEqual([
      `Changeset: ${base.changesetId}`,
    ]);
    expect(trailers.filter((l) => l.startsWith("Source:"))).toEqual(["Source: library-editor"]);
  });

  it("is read back by git as trailers", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-msg-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
          encoding: "utf8",
          input: args.includes("-F")
            ? commitMessage({ ...base, resolvesReports: ["fb_01"] })
            : undefined,
        });
      git("init", "-q");
      git("commit", "-q", "--allow-empty", "-F", "-");
      const out = git("log", "-1", "--format=%(trailers:only,unfold)");
      expect(out.trim().split("\n")).toEqual([
        "Change-Class: process",
        "Changeset: cs_01J9ZB4M3FQ8R2T6V0X4Z8C2E6",
        "Source: library-editor",
        "Resolves-Report: fb_01",
        "Co-authored-by: Maria Reyes <maria.reyes@acme.edu>",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
