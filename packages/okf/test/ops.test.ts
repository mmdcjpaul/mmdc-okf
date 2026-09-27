import { describe, expect, it } from "vitest";
import { generateIndexes } from "../src/indexes.ts";
import { lint } from "../src/lint/index.ts";
import { noteLinks } from "../src/links.ts";
import { bump, moveNote, newNote, verify } from "../src/ops/notes.ts";
import { setNamespace, setProfileTeams } from "../src/ops/config.ts";
import { addAlias, addTerm, mergeTerms, renameTerm } from "../src/ops/taxonomy.ts";
import { parseNote } from "../src/note.ts";
import { MemorySource, OverlaySource } from "../src/source.ts";
import type { FileOp } from "../src/types.ts";
import { contentNotes, loadVault, type Vault } from "../src/vault.ts";
import { hubKindOf } from "../src/paths.ts";
import { acmeSource, NOW } from "./helpers.ts";

const ACTOR = "human:mreyes";

/** Applies ops, regenerates indexes, and returns the resulting vault. */
async function applyAndIndex(
  src: MemorySource,
  ops: FileOp[],
): Promise<{ src: MemorySource; vault: Vault }> {
  let next = src.apply(ops);
  next = next.apply(await generateIndexes(await loadVault(next), { now: NOW }));
  return { src: next, vault: await loadVault(next) };
}

const loadAcme = async () => loadVault(await acmeSource());

async function errors(vault: Vault): Promise<string[]> {
  const report = await lint(vault, { now: NOW });
  return report.issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`);
}

function text(ops: FileOp[], path: string): string {
  const op = ops.find((o) => o.path === path);
  if (!op || op.op !== "put") throw new Error(`no put for ${path}`);
  return String(op.content);
}

describe("newNote", () => {
  it.each([
    "How-To",
    "Process",
    "Explanation",
    "Reference",
    "Policy",
    "Decision",
    "Runbook",
    "Request Type",
    "Action",
  ])("creates a %s that lints clean", async (type) => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const ops = newNote(
      vault,
      {
        type,
        title: `New ${type} note`,
        namespace: "it-support",
        themes: ["onboarding"],
        systems: ["lms"],
        description: "A test note.",
      },
      ACTOR,
      NOW,
    );
    const { vault: after } = await applyAndIndex(src, ops);
    expect(await errors(after)).toEqual([]);
    const note = after.notes.get(ops[0]!.path)!;
    expect(note.data.generated).toEqual({ by: ACTOR, at: "2026-09-24T00:00:00Z" });
    expect(noteLinks(after, note).some((l) => l.resolved.path === "kb/_themes/onboarding.md")).toBe(
      true,
    );
  });

  it("writes the stable key order and refuses to overwrite", async () => {
    const vault = await loadVault(acmeSource());
    const ops = newNote(
      vault,
      {
        type: "How-To",
        title: "Enroll a visiting student",
        namespace: "admissions",
        themes: ["enrollment"],
        systems: ["salesforce"],
        status: "draft",
        id: "kb_01J9ZTEST0000000000000000X",
      },
      ACTOR,
      NOW,
    );
    expect(ops).toMatchSnapshot();
    expect(() =>
      newNote(
        vault,
        {
          type: "How-To",
          title: "Enroll a new student",
          namespace: "admissions",
          themes: ["enrollment"],
        },
        ACTOR,
        NOW,
      ),
    ).toThrow(/already exists/);
  });
});

describe("moveNote", () => {
  it("rewrites all five inbound links and keeps the id", async () => {
    const src = acmeSource();
    const target = "kb/admissions/enrollment-status-codes.md";
    // Two more inbound links, one relative, to reach five.
    src.files.set(
      "kb/admissions/extra-one.md",
      "---\ntype: Reference\ntitle: Extra one\ndescription: d\nid: kb_01J9ZEXTRA0000000000000001\nversion: 1.0.0\nthemes: [enrollment]\n---\n\nSee [codes](./enrollment-status-codes.md#details) and [Enrollment](/_themes/enrollment.md).\n",
    );
    src.files.set(
      "kb/finance/extra-two.md",
      "---\ntype: Reference\ntitle: Extra two\ndescription: d\nid: kb_01J9ZEXTRA0000000000000002\nversion: 1.0.0\nthemes: [enrollment]\n---\n\nSee [codes][c] and [Enrollment](/_themes/enrollment.md).\n\n[c]: ../admissions/enrollment-status-codes.md\n",
    );
    const vault = await loadVault(src);
    const inbound = contentNotes(vault)
      .filter((n) => !hubKindOf(vault.root, n.path))
      .filter((n) => noteLinks(vault, n).some((l) => l.resolved.path === target));
    expect(inbound.length).toBe(5);

    const ops = moveNote(
      vault,
      "/admissions/enrollment-status-codes.md",
      "/admissions/reference/enrollment-status-codes-and-meanings.md",
    );
    expect(ops.find((o) => o.path === target)).toEqual({ op: "delete", path: target });
    const { vault: after } = await applyAndIndex(src, ops);
    const moved = after.notes.get(
      "kb/admissions/reference/enrollment-status-codes-and-meanings.md",
    )!;
    expect(moved.data.id).toBe(vault.notes.get(target)!.data.id);
    const report = await lint(after, { now: NOW });
    expect(report.issues.filter((i) => i.rule === "lore/link-targets").map((i) => i.path)).toEqual([
      "kb/it-support/reset-a-staff-password.md",
    ]);
    expect(text(ops, "kb/admissions/extra-one.md")).toContain(
      "[codes](./reference/enrollment-status-codes-and-meanings.md#details)",
    );
    expect(text(ops, "kb/finance/extra-two.md")).toContain(
      "[c]: ../admissions/reference/enrollment-status-codes-and-meanings.md",
    );
    expect(await errors(after)).toEqual([]);
  });

  it("recomputes relative links inside the moved note and updates path fields", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const ops = moveNote(
      vault,
      "kb/admissions/enroll-a-new-student.md",
      "kb/admissions/new/enroll-a-first-time-student.md",
    );
    expect(text(ops, "kb/admissions/submit-a-paper-enrollment-form.md")).toContain(
      "superseded_by: /admissions/new/enroll-a-first-time-student.md",
    );
    expect(text(ops, "kb/admissions/log.md")).toContain(
      "[Enroll a new student](/admissions/new/enroll-a-first-time-student.md)",
    );
    const { vault: after } = await applyAndIndex(src, ops);
    expect(await errors(after)).toEqual([]);
  });
});

describe("bump", () => {
  it("writes a log entry and resets verification for a process change", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const path = "kb/admissions/enroll-a-returning-student-in-salesforce.md";
    const ops = bump(vault, path, "process", ACTOR, NOW);
    expect(ops.map((o) => o.path)).toEqual([path, "kb/admissions/log.md"]);
    const note = parseNote(text(ops, path), path);
    expect(note.data.version).toBe("2.0.0");
    expect(note.data.verified).toBeUndefined();
    expect(note.data.stale_after).toBeUndefined();
    expect(note.data.generated).toEqual({ by: ACTOR, at: "2026-09-24T00:00:00Z" });
    expect(text(ops, "kb/admissions/log.md").split("\n").slice(0, 5)).toEqual([
      "# Admissions log",
      "",
      "## 2026-09-24",
      "",
      "- Process change: [Enroll a returning student in Salesforce](/admissions/enroll-a-returning-student-in-salesforce.md) 1.2.0 to 2.0.0 by human:mreyes",
    ]);
    const { vault: after } = await applyAndIndex(src, ops);
    expect(await errors(after)).toEqual([]);
    expect(ops).toMatchSnapshot();
  });

  it("bumps a patch for a fix without touching generated or verified", async () => {
    const vault = await loadVault(acmeSource());
    const path = "kb/admissions/enroll-a-returning-student-in-salesforce.md";
    const before = vault.notes.get(path)!;
    const ops = bump(vault, path, "fix", ACTOR, NOW);
    const after = parseNote(text(ops, path), path);
    expect(after.data.version).toBe("1.2.1");
    expect(after.data.generated).toEqual(before.data.generated);
    expect(after.data.verified).toEqual(before.data.verified);
    expect(ops).toHaveLength(1);
    const addition = parseNote(
      text(bump(vault, path, "addition", "claude-code/claude-sonnet-5", NOW), path),
      path,
    );
    expect(addition.data.version).toBe("1.3.0");
    expect(addition.data.generated).toEqual({
      by: "claude-code/claude-sonnet-5",
      at: "2026-09-24T00:00:00Z",
    });
  });
});

describe("verify", () => {
  it("appends a verification and sets stale_after from the review interval", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const path = "kb/finance/how-deposits-flow-from-salesforce-to-netsuite.md";
    const ops = verify(vault, path, "human:bchan", NOW);
    const note = parseNote(text(ops, path), path);
    expect(note.data.verified).toEqual([{ by: "human:bchan", at: "2026-09-24T00:00:00Z" }]);
    expect(note.data.stale_after).toBe("2027-09-24T00:00:00Z");
    const { vault: after } = await applyAndIndex(src, ops);
    expect(await errors(after)).toEqual([]);
    expect(ops).toMatchSnapshot();
  });

  it("refuses agents and processes", async () => {
    const vault = await loadVault(acmeSource());
    expect(() =>
      verify(vault, "kb/finance/refund-policy.md", "claude-code/claude-sonnet-5", NOW),
    ).toThrow(/Only people/);
    expect(() => verify(vault, "kb/finance/refund-policy.md", "process:gardener", NOW)).toThrow(
      /Only people/,
    );
  });
});

describe("taxonomy", () => {
  it("renames a tag everywhere and keeps the old name as an alias", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const ops = renameTerm(vault, "tag", "duplicates", "duplicate-records-cleanup", NOW);
    const { vault: after } = await applyAndIndex(src, ops);
    expect(after.tags["duplicate-records-cleanup"]!.aliases).toEqual(
      expect.arrayContaining(["duplicate-records", "duplicates"]),
    );
    expect(after.tags.duplicates).toBeUndefined();
    expect(
      [...after.notes.values()].filter((n) =>
        (n.data.tags as string[] | undefined)?.includes("duplicates"),
      ),
    ).toEqual([]);
    expect(await errors(after)).toEqual([]);
    expect(ops.map((o) => o.path)).toMatchSnapshot();
  });

  it("renames a theme hub, rewriting links and every note's themes", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const ops = renameTerm(vault, "theme", "month-end-close", "financial-close", NOW);
    const { vault: after } = await applyAndIndex(src, ops);
    expect(after.themes.get("financial-close")!.aliases).toContain("month-end-close");
    expect(after.themes.has("month-end-close")).toBe(false);
    expect(await errors(after)).toEqual([]);
    const report = await lint(after, { now: NOW });
    expect(report.issues.filter((i) => i.rule === "lore/link-targets")).toHaveLength(1);
    expect(text(ops, "kb/log.md")).toContain(
      "Renamed theme `month-end-close` to `financial-close`",
    );
  });

  it("merges systems into one", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const ops = mergeTerms(vault, "system", ["sis", "lms"], "salesforce", NOW);
    const { vault: after } = await applyAndIndex(src, ops);
    expect(after.systems.has("sis")).toBe(false);
    expect(after.systems.get("salesforce")!.aliases).toEqual(
      expect.arrayContaining(["sfdc", "sis", "student information system", "lms", "canvas"]),
    );
    const returning = after.notes.get("kb/admissions/enroll-a-returning-student-in-salesforce.md")!;
    expect(returning.data.systems).toEqual(["salesforce"]);
    expect(await errors(after)).toEqual([]);
  });

  it("merges tags and adds a new one", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const merged = mergeTerms(vault, "tag", ["deposits", "refunds"], "reconciliation", NOW);
    const { vault: after } = await applyAndIndex(src, merged);
    expect(after.tags.reconciliation!.aliases).toEqual(
      expect.arrayContaining(["deposits", "refunds", "refund"]),
    );
    expect(await errors(after)).toEqual([]);
    const added = addTerm(
      after,
      "tag",
      "scholarships",
      { description: "Scholarships and grants." },
      ACTOR,
      NOW,
    );
    expect(
      String((added.find((o) => o.path === ".kb/tags.yaml") as { content: string }).content),
    ).toContain("scholarships: { description: Scholarships and grants., aliases: [] }");
    const hub = addTerm(
      after,
      "system",
      "zendesk",
      { title: "Zendesk", description: "Support desk." },
      ACTOR,
      NOW,
    );
    const withHub = await applyAndIndex(after.src as MemorySource, hub);
    expect(withHub.vault.systems.has("zendesk")).toBe(true);
    expect(await errors(withHub.vault)).toEqual([]);
  });

  it("rejects bad input", async () => {
    const vault = await loadVault(acmeSource());
    expect(() => renameTerm(vault, "tag", "nope", "x")).toThrow(/Unknown tag/);
    expect(() => renameTerm(vault, "tag", "refunds", "payroll")).toThrow(/use merge/);
    expect(() => renameTerm(vault, "tag", "refunds", "Not A Slug")).toThrow(/kebab-case/);
  });
});

describe("addAlias", () => {
  it("adds another name for a tag, keeping the rest of tags.yaml as it was", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const ops = addAlias(vault, "tag", "refunds", "cheque-refunds", NOW);
    expect(ops.map((o) => o.path).sort()).toEqual([".kb/tags.yaml", "kb/log.md"]);
    const { vault: after } = await applyAndIndex(src, ops);
    expect(after.tags.refunds!.aliases).toContain("cheque-refunds");
    expect(Object.keys(after.tags)).toEqual(Object.keys(vault.tags));
    expect(await errors(after)).toEqual([]);
  });

  it("adds another name for a theme on its hub", async () => {
    const src = acmeSource();
    const vault = await loadVault(src);
    const ops = addAlias(vault, "theme", "month-end-close", "financial-close", NOW);
    const { vault: after } = await applyAndIndex(src, ops);
    expect(after.themes.get("month-end-close")!.aliases).toContain("financial-close");
    expect(await errors(after)).toEqual([]);
  });

  it("does nothing when the name is already there, and refuses names that are taken", async () => {
    const vault = await loadAcme();
    const [term, entry] = Object.entries(vault.tags).find(([, t]) => t.aliases.length > 0)!;
    expect(addAlias(vault, "tag", term, entry.aliases[0]!, NOW)).toEqual([]);
    const other = Object.keys(vault.tags).find((t) => t !== term)!;
    expect(() => addAlias(vault, "tag", other, entry.aliases[0]!)).toThrow(/already another name/);
    expect(() => addAlias(vault, "tag", other, term)).toThrow(/use merge/);
    expect(() => addAlias(vault, "tag", "nope", "x")).toThrow(/Unknown tag/);
    expect(() => addAlias(vault, "tag", other, "Not A Slug")).toThrow(/kebab-case/);
  });
});

describe("setNamespace and setProfileTeams", () => {
  it("changes one namespace and leaves the rest of the file alone", async () => {
    const vault = await loadAcme();
    const before = vault.aux.get(".kb/namespaces.yaml")!;
    const ops = setNamespace(vault, "finance", { visibility: "restricted", publishing: "auto" });
    expect(ops).toHaveLength(1);
    const after = (ops[0] as { content: string }).content;
    const block = (text: string, ns: string) =>
      text.slice(text.indexOf(`${ns}:`)).split(/\n(?=\S)/)[0]!;
    expect(block(after, "finance")).toContain("visibility: restricted");
    expect(block(after, "finance")).toContain("publishing: auto");
    expect(block(after, "finance")).toContain("owner: finance-systems");
    // The other namespaces are byte for byte what they were.
    for (const ns of ["admissions", "it-support", "people-ops"])
      expect(block(after, ns)).toBe(block(before, ns));
    const next = await loadVault(new OverlaySource(vault.src, ops));
    expect(next.namespaces.finance).toMatchObject({ visibility: "restricted", publishing: "auto" });
    expect((await lint(next, { now: NOW })).errors).toBe(0);
  });

  it("registers a new namespace, manual by default", async () => {
    const vault = await loadAcme();
    const ops = setNamespace(vault, "legal", { title: "Legal", owner: "people-ops" });
    const next = await loadVault(new OverlaySource(vault.src, ops));
    expect(next.namespaces.legal).toMatchObject({
      title: "Legal",
      publishing: "manual",
      visibility: "company",
    });
    expect(() => setNamespace(vault, "Legal Team", { title: "x" })).toThrow(
      /not a valid namespace/,
    );
    expect(() => setNamespace(vault, "_themes", { title: "x" })).toThrow(/not a valid namespace/);
    expect(() => setNamespace(vault, "legal", {})).toThrow(/needs a title/);
  });

  it("changes nothing when nothing changes", async () => {
    const vault = await loadAcme();
    expect(setNamespace(vault, "finance", { visibility: "company" })).toEqual([]);
    expect(setProfileTeams(vault, [...vault.profile.teams])).toEqual([]);
  });

  it("keeps the profile's comments when teams change", async () => {
    const vault = await loadAcme();
    const ops = setProfileTeams(vault, [...vault.profile.teams, "legal"]);
    const after = (ops[0] as { content: string }).content;
    const before = vault.aux.get(".kb/profile.yaml")!;
    expect(after.split("\n").filter((l) => l.trim().startsWith("#"))).toEqual(
      before.split("\n").filter((l) => l.trim().startsWith("#")),
    );
    expect((await loadVault(new OverlaySource(vault.src, ops))).profile.teams).toContain("legal");
  });
});
