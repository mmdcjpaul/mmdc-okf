import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/main.ts";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const ACME = join(REPO, "fixtures/vault-acme");
const DIST = join(REPO, "packages/cli/dist/kb.js");
const NOW = new Date("2026-09-24T00:00:00Z");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kb-cli-"));
  cpSync(ACME, dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "mreyes@acme.test");
  git("config", "user.name", "M Reyes");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function kb(args: string[], env: Record<string, string> = {}) {
  let out = "";
  let err = "";
  const code = await run(args, {
    cwd: dir,
    now: NOW,
    env: { ...env },
    io: { out: (t) => void (out += t), err: (t) => void (err += t) },
  });
  return { code, out, err };
}

const read = (p: string) => readFileSync(join(dir, p), "utf8");
const scrubIds = (t: string) => t.replace(/kb_[0-9A-HJKMNP-TV-Z]{26}/g, "kb_<id>");

describe("kb lint", () => {
  it("passes on vault-acme with warnings only", async () => {
    const r = await kb(["lint"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatchSnapshot();
  });

  it("exits 1 on errors and prints JSON and GitHub formats", async () => {
    writeFileSync(join(dir, "kb/finance/bad.md"), "---\ntype: How-To\ntitle: Bad\n---\n\nNo id.\n");
    const r = await kb(["lint", "--format", "json,github", "kb/finance/bad.md"]);
    expect(r.code).toBe(1);
    const json = JSON.parse(r.out.slice(0, r.out.lastIndexOf("}") + 1));
    expect(json.errors).toBe(4);
    expect(r.out).toContain(
      '::error file=kb/finance/bad.md,line=1,col=1,title=lore/required::Missing required field "description"',
    );
  });

  it("--fix converts wikilinks and adds ids", async () => {
    writeFileSync(
      join(dir, "kb/finance/wiki.md"),
      "---\ntype: How-To\ntitle: Wiki links\ndescription: Uses wikilinks.\nthemes: [enrollment]\n---\n\nSee [[Refund policy]] and [[Enrollment]].\n",
    );
    const r = await kb(["lint", "--fix", "kb/finance/wiki.md"]);
    expect(r.code).toBe(0);
    const text = read("kb/finance/wiki.md");
    expect(text).toMatch(/^id: kb_[0-9A-HJKMNP-TV-Z]{26}$/m);
    expect(text).toContain("version: 1.0.0");
    expect(text).toContain(
      "See [Refund policy](/finance/refund-policy.md) and [Enrollment](/_themes/enrollment.md).",
    );
  });
});

describe("kb new", () => {
  it("writes a templated note with a fresh id", async () => {
    const r = await kb([
      "new",
      "How-To",
      "Waive a late enrollment fee",
      "--ns",
      "finance",
      "--theme",
      "enrollment",
      "--system",
      "netsuite",
      "--tag",
      "refunds",
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("  wrote   kb/finance/waive-a-late-enrollment-fee.md\n");
    expect(scrubIds(read("kb/finance/waive-a-late-enrollment-fee.md"))).toMatchSnapshot();
    expect((await kb(["lint", "kb/finance/waive-a-late-enrollment-fee.md"])).code).toBe(0);
  });

  it("refuses invented taxonomy and unknown types with exit 2", async () => {
    const r = await kb(["new", "How-To", "X", "--ns", "finance", "--theme", "made-up"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Unknown theme "made-up"');
    expect((await kb(["new", "Howto", "X", "--ns", "finance", "--theme", "enrollment"])).code).toBe(
      2,
    );
    expect(
      (
        await kb([
          "new",
          "How-To",
          "Enroll a new student",
          "--ns",
          "admissions",
          "--theme",
          "enrollment",
        ])
      ).code,
    ).toBe(2);
  });

  it("uses KB_ACTOR for generated.by", async () => {
    await kb(
      [
        "new",
        "Reference",
        "Deposit amounts by program",
        "--ns",
        "finance",
        "--theme",
        "enrollment",
      ],
      { KB_ACTOR: "claude-code/claude-sonnet-5" },
    );
    expect(read("kb/finance/deposit-amounts-by-program.md")).toContain(
      "generated: { by: claude-code/claude-sonnet-5, at: 2026-09-24T00:00:00Z }",
    );
  });
});

describe("kb query and kb related", () => {
  it("returns the returning-student note first", async () => {
    const r = await kb(["query", "re-enroll returning student", "--json"]);
    const hits = JSON.parse(r.out);
    expect(hits[0].path).toBe("kb/admissions/enroll-a-returning-student-in-salesforce.md");
    expect(existsSync(join(dir, ".kb/.cache/query-index.bin"))).toBe(true);
  });

  it("filters by namespace and type, and picks up edits through the cache", async () => {
    const first = JSON.parse(
      (await kb(["query", "refund", "--ns", "finance", "--type", "Policy", "--json"])).out,
    );
    expect(first.map((h: { path: string }) => h.path)).toEqual(["kb/finance/refund-policy.md"]);
    writeFileSync(
      join(dir, "kb/finance/refund-policy.md"),
      read("kb/finance/refund-policy.md").replace("Refund policy", "Zanzibar refund policy"),
    );
    const again = JSON.parse((await kb(["query", "zanzibar", "--json"])).out);
    expect(again[0].title).toBe("Zanzibar refund policy");
  });

  it("lists links, backlinks, and similar notes", async () => {
    const r = await kb(["related", "kb/admissions/clean-up-duplicate-contacts.md", "--json"]);
    const res = JSON.parse(r.out);
    expect(res.outbound.map((h: { path: string }) => h.path)).toContain(
      "kb/admissions/enroll-a-returning-student-in-salesforce.md",
    );
    expect(res.inbound.map((h: { path: string }) => h.path)).toContain(
      "kb/admissions/use-the-student-id-as-the-primary-key.md",
    );
    expect(res.similar[0].path).toBe("kb/admissions/merge-duplicate-student-records.md");
    expect((await kb(["related", "kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D"])).out).toMatchSnapshot();
  });

  it("reports that --remote is not configured", async () => {
    const r = await kb(["related", "kb/finance/refund-policy.md", "--remote"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Lore API not configured");
  });
});

describe("kb index", () => {
  it("--check passes on a current vault and fails after a change", async () => {
    expect((await kb(["index", "--check"])).code).toBe(0);
    await kb([
      "new",
      "How-To",
      "Pay a vendor by wire",
      "--ns",
      "finance",
      "--theme",
      "month-end-close",
    ]);
    const check = await kb(["index", "--check"]);
    expect(check.code).toBe(1);
    expect(check.out).toContain("kb/_themes/month-end-close.md");
    const r = await kb(["index"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("wrote   kb/finance/index.md");
    expect((await kb(["index", "--check"])).code).toBe(0);
  });
});

describe("kb mv, bump, verify", () => {
  it("moves a note and rewrites inbound links", async () => {
    const r = await kb([
      "mv",
      "kb/finance/refund-policy.md",
      "kb/finance/policies/student-refund-policy.md",
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toMatchSnapshot();
    expect(read("kb/finance/issue-a-student-refund.md")).toContain(
      "[refund policy](/finance/policies/student-refund-policy.md)",
    );
    expect(existsSync(join(dir, "kb/finance/refund-policy.md"))).toBe(false);
    await kb(["index"]);
    expect((await kb(["lint"])).code).toBe(0);
  });

  it("bumps a process change and writes the log entry", async () => {
    const r = await kb([
      "bump",
      "kb/finance/refund-policy.md",
      "--class",
      "process",
      "--summary",
      "Deposits are now refundable until 14 days before term",
    ]);
    expect(r.code).toBe(0);
    expect(read("kb/finance/refund-policy.md")).toContain("version: 2.0.0");
    expect(read("kb/finance/log.md")).toContain(
      "- Process change: [Refund policy](/finance/refund-policy.md) 1.0.0 to 2.0.0 by human:mreyes. Deposits are now refundable until 14 days before term",
    );
    expect((await kb(["bump", "kb/finance/refund-policy.md", "--class", "major"])).code).toBe(2);
  });

  it("verifies as a person and refuses agents", async () => {
    const agent = await kb(
      ["verify", "kb/finance/how-deposits-flow-from-salesforce-to-netsuite.md"],
      { KB_ACTOR: "claude-code/claude-sonnet-5" },
    );
    expect(agent.code).toBe(2);
    expect(agent.err).toContain("Only people can verify");
    const human = await kb([
      "verify",
      "kb/finance/how-deposits-flow-from-salesforce-to-netsuite.md",
    ]);
    expect(human.code).toBe(0);
    expect(read("kb/finance/how-deposits-flow-from-salesforce-to-netsuite.md")).toContain(
      "  - { by: human:mreyes, at: 2026-09-24T00:00:00Z }",
    );
  });
});

describe("kb taxonomy", () => {
  it("lists the vocabulary", async () => {
    const r = await kb(["taxonomy", "list", "--kind", "themes"]);
    expect(r.out).toMatchSnapshot();
    const json = JSON.parse((await kb(["taxonomy", "list", "--json"])).out);
    expect(Object.keys(json)).toEqual([
      "namespaces",
      "types",
      "themes",
      "systems",
      "tags",
      "teams",
    ]);
  });

  it("adds, renames, and merges terms", async () => {
    expect(
      (
        await kb([
          "taxonomy",
          "add",
          "tag",
          "scholarships",
          "--description",
          "Scholarships and grants.",
        ])
      ).code,
    ).toBe(0);
    expect(read(".kb/tags.yaml")).toContain(
      "scholarships: { description: Scholarships and grants., aliases: [] }",
    );
    expect((await kb(["taxonomy", "rename", "tag", "refunds", "student-refunds"])).code).toBe(0);
    expect(read("kb/finance/refund-policy.md")).toContain("tags: [student-refunds]");
    expect(
      (await kb(["taxonomy", "merge", "theme", "onboarding", "--into", "access-management"])).code,
    ).toBe(0);
    expect(existsSync(join(dir, "kb/_themes/onboarding.md"))).toBe(false);
    await kb(["index"]);
    const lint = await kb(["lint"]);
    expect(lint.code).toBe(0);
    expect((await kb(["taxonomy", "rename", "tag", "nope", "x"])).code).toBe(2);
  });
});

describe("kb migrate and usage", () => {
  it("ships a no-op 0.2 migration", async () => {
    const r = await kb(["migrate"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Nothing to migrate.");
    expect((await kb(["migrate", "--to", "0.3"])).code).toBe(2);
  });

  it("exits 2 on usage errors and outside a vault", async () => {
    expect((await kb(["frobnicate"])).code).toBe(2);
    expect((await kb(["lint", "--format", "xml"])).code).toBe(2);
    const outside = mkdtempSync(join(tmpdir(), "kb-none-"));
    const r = await run(["lint"], { cwd: outside, io: { out: () => {}, err: () => {} } });
    expect(r).toBe(2);
    rmSync(outside, { recursive: true });
  });
});

describe("bundled binary", () => {
  it.skipIf(!existsSync(DIST))("runs lint from dist/kb.js with node only", () => {
    const r = spawnSync(process.execPath, [DIST, "lint"], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("0 errors");
  });
});
