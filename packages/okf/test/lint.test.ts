import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestTypeSchema, actionParameterSchema } from "../src/fields.ts";
import { fix, lint } from "../src/lint/index.ts";
import { formatGithub, formatHuman } from "../src/lint/format.ts";
import { RULES } from "../src/lint/rules.ts";
import { MemorySource, OverlaySource } from "../src/source.ts";
import type { FileOp } from "../src/types.ts";
import { loadVault } from "../src/vault.ts";
import { acmeSource, DIRTY, dirtyRules, dirtySource, idCounter, NOW, readTree } from "./helpers.ts";

describe("vault-dirty", () => {
  it("has a case for every rule", () => {
    expect(dirtyRules()).toEqual(RULES.map((r) => r.id).sort());
  });

  describe.each(dirtyRules())("%s", (rule) => {
    const dir = join(DIRTY, rule);

    it("reports the expected issues", async () => {
      const vault = await loadVault(dirtySource(rule));
      const report = await lint(vault, { now: NOW });
      const expected = JSON.parse(readFileSync(join(dir, "expected-issues.json"), "utf8"));
      expect(expected.length).toBeGreaterThan(0);
      expect(report.issues.filter((i) => i.rule === rule)).toEqual(expected);
    });

    it("fixes to the expected output, and fixing again changes nothing", async () => {
      const src = dirtySource(rule);
      const vault = await loadVault(src);
      const report = await lint(vault, { now: NOW });
      const mine = { ...report, issues: report.issues.filter((i) => i.rule === rule) };
      const ops = await fix(vault, mine, { now: NOW, newId: idCounter() });
      const expectedDir = join(dir, "expected");
      const expected = existsSync(expectedDir) ? readTree(expectedDir) : {};
      const actual: Record<string, string> = {};
      for (const op of ops)
        actual[op.op === "put" ? op.path : op.path + ".deleted"] =
          op.op === "put" ? String(op.content) : "";
      expect(actual).toEqual(expected);

      const fixedVault = await loadVault(src.apply(ops));
      const again = await lint(fixedVault, { now: NOW });
      const remaining = { ...again, issues: again.issues.filter((i) => i.rule === rule) };
      expect(await fix(fixedVault, remaining, { now: NOW, newId: idCounter() })).toEqual([]);
      expect(remaining.issues.some((i) => i.fixable)).toBe(false);
    });
  });
});

describe("vault-acme", () => {
  it("lints with zero errors", async () => {
    const report = await lint(await loadVault(acmeSource()), { now: NOW });
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report.checked).toBeGreaterThan(50);
    // The known warnings: the orphan with no hub link and the wanted note.
    expect(report.issues.map((i) => `${i.rule} ${i.path}`)).toEqual(
      [
        "lore/link-targets kb/it-support/reset-a-staff-password.md",
        "lore/hub-link kb/it-support/set-up-a-campus-printer.md",
      ].sort((a, b) => (a.split(" ")[1]! < b.split(" ")[1]! ? -1 : 1)),
    );
  });

  it("filters the report to the given paths", async () => {
    const vault = await loadVault(acmeSource());
    const report = await lint(vault, { now: NOW, paths: ["kb/it-support/runbooks"] });
    expect(report.issues).toEqual([]);
    expect(report.checked).toBe(2);
  });

  it("lets the profile or caller turn rules off or change severity", async () => {
    const vault = await loadVault(acmeSource());
    const off = await lint(vault, {
      now: NOW,
      rules: { "lore/hub-link": "off", "lore/link-targets": "error" },
    });
    expect(off.issues.map((i) => `${i.rule}:${i.severity}`)).toEqual(["lore/link-targets:error"]);
  });
});

describe("fix", () => {
  it("is idempotent when every fixable rule fires at once", async () => {
    const files: Record<string, string | Uint8Array> = {};
    for (const rule of [
      "lore/required",
      "lore/vocabulary",
      "lore/wikilinks",
      "lore/hub-members",
      "okf/reserved-files",
    ]) {
      const src = dirtySource(rule);
      for (const p of await src.list("")) {
        const key = p.startsWith("kb/docs/")
          ? p.replace("kb/docs/", `kb/docs/${rule.replace("/", "-")}-`)
          : p;
        if (p.endsWith("/index.md") || p.endsWith("/log.md") || p === "kb/index.md") continue;
        files[key] = (await src.read(p))!;
      }
    }
    files["kb/docs/index.md"] = "---\nfoo: bar\n---\n";
    const src = new MemorySource(files);
    const vault = await loadVault(src);
    const once = await fix(vault, await lint(vault, { now: NOW }), {
      now: NOW,
      newId: idCounter(),
    });
    expect(once.length).toBeGreaterThan(3);
    const after = await loadVault(src.apply(once));
    const twice = await fix(after, await lint(after, { now: NOW }), {
      now: NOW,
      newId: idCounter(),
    });
    expect(twice).toEqual([]);
  });
});

describe("linting a changeset in memory", () => {
  it("fails an overlay that adds a duplicate id while the same note alone passes", async () => {
    const base = acmeSource();
    const baseVault = await loadVault(base);
    const existing = baseVault.notes.get("kb/admissions/enroll-a-new-student.md")!;
    const id = existing.data.id as string;
    const note = `---
type: How-To
title: Enroll a transfer student
description: Enroll a student who transfers in from another school.
id: ${id}
version: 1.0.0
themes: [enrollment]
---

# Related

- [Enrollment](/_themes/enrollment.md)
`;
    const ops: FileOp[] = [
      { op: "put", path: "kb/admissions/enroll-a-transfer-student.md", content: note },
    ];
    const overlay = await loadVault(new OverlaySource(base, ops));
    const withDup = await lint(overlay, {
      now: NOW,
      paths: ["kb/admissions/enroll-a-transfer-student.md"],
    });
    expect(withDup.issues.filter((i) => i.rule === "lore/duplicate-id")).toHaveLength(1);

    const alone = await loadVault(
      new MemorySource({
        ...Object.fromEntries(
          await Promise.all((await base.list(".kb/")).map(async (p) => [p, (await base.read(p))!])),
        ),
        ...Object.fromEntries(
          await Promise.all(
            (await base.list("kb/_themes/")).map(async (p) => [p, (await base.read(p))!]),
          ),
        ),
        "kb/admissions/enroll-a-transfer-student.md": note,
      }),
    );
    const clean = await lint(alone, {
      now: NOW,
      paths: ["kb/admissions/enroll-a-transfer-student.md"],
    });
    expect(clean.errors).toBe(0);
    // Nothing was written to the base source.
    expect(await base.read("kb/admissions/enroll-a-transfer-student.md")).toBeNull();
  });
});

describe("requestTypeSchema", () => {
  it("accepts and rejects payloads for each field type", async () => {
    const vault = await loadVault(acmeSource());
    const netsuite = requestTypeSchema(
      vault.notes.get("kb/finance/request-types/request-access-to-netsuite.md")!,
    );
    const laptop = requestTypeSchema(
      vault.notes.get("kb/it-support/request-types/request-a-laptop.md")!,
    );
    const outage = requestTypeSchema(
      vault.notes.get("kb/it-support/request-types/report-an-lms-outage.md")!,
    );

    const good = {
      user_email: "new.hire@acme.test",
      role: "AP Clerk",
      reason: "Paying vendor bills",
      needed_by: "2026-10-01",
    };
    expect(netsuite.safeParse(good).success).toBe(true);
    expect(netsuite.safeParse({ ...good, needed_by: undefined }).success).toBe(true);
    expect(netsuite.safeParse({ ...good, user_email: "not-an-email" }).success).toBe(false); // email
    expect(netsuite.safeParse({ ...good, role: "Admin" }).success).toBe(false); // select
    expect(netsuite.safeParse({ ...good, reason: "  " }).success).toBe(false); // required text
    expect(netsuite.safeParse({ ...good, needed_by: "next week" }).success).toBe(false); // date
    expect(netsuite.shape.user_email!.description).toBe("Who needs access?");

    expect(
      laptop.safeParse({ for_whom: "a@acme.test", reason: "Broken", needs_accessories: true })
        .success,
    ).toBe(true);
    expect(
      laptop.safeParse({ for_whom: "a@acme.test", reason: "Broken", needs_accessories: "yes" })
        .success,
    ).toBe(false); // boolean

    expect(
      outage.safeParse({ what_happens: "Login page times out", students_affected: 30 }).success,
    ).toBe(true);
    expect(outage.safeParse({ what_happens: "Down", students_affected: "thirty" }).success).toBe(
      false,
    ); // number
  });

  it("converts Action parameters", async () => {
    const vault = await loadVault(acmeSource());
    const refund = actionParameterSchema(
      vault.notes.get("kb/finance/actions/issue-a-small-refund.md")!,
    );
    expect(
      refund.safeParse({ student_id: "S123", amount: 200, reason: "withdrawal" }).success,
    ).toBe(true);
    expect(refund.safeParse({ student_id: "S123", amount: 200, reason: "because" }).success).toBe(
      false,
    );
    expect(refund.safeParse({ student_id: "S123", reason: "withdrawal" }).success).toBe(false);
  });
});

describe("report formats", () => {
  it("formats human and GitHub output", async () => {
    const vault = await loadVault(dirtySource("lore/vocabulary"));
    const report = await lint(vault, { now: NOW, rules: { "lore/hub-members": "off" } });
    const human = formatHuman(report);
    expect(human).toContain("kb/docs/unknown-terms.md");
    expect(human).toMatch(/✖ \d+ errors?/);
    const gh = formatGithub(report).split("\n")[0]!;
    expect(gh).toMatch(
      /^::error file=kb\/docs\/unknown-terms\.md,line=\d+,col=\d+,title=lore\/vocabulary::/,
    );
  });
});
