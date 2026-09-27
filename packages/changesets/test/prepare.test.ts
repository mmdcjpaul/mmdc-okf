import { gitBlobSha, lint, loadVault, OverlaySource, parseNote, type FileOp } from "@lore/okf";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareChangeset, type ChangesetIntent, type Prepared } from "../src/index.ts";
import { acme, context, input, NOW } from "./helpers.ts";

const RETURNING = "kb/admissions/enroll-a-returning-student-in-salesforce.md";
const STATUS = "kb/admissions/check-an-applications-status.md";
const REFUND = "kb/finance/refund-policy.md";

const src = acme();
const text = (path: string) => src.files.get(path) as string;
const edit = (path: string, fn: (s: string) => string): FileOp => ({
  op: "put",
  path,
  content: fn(text(path)),
});
const base = (...paths: string[]) =>
  Object.fromEntries(
    paths.map((p) => [p, src.files.has(p) ? gitBlobSha(src.files.get(p)!) : null]),
  );
const put = (p: Prepared, path: string) => {
  const op = p.finalOps.find((o) => o.path === path);
  if (!op || op.op !== "put" || typeof op.content !== "string")
    throw new Error(`No put for ${path}`);
  return { text: op.content, data: parseNote(op.content, path).data };
};
const addLine = (s: string) => s + "\nAsk the registrar if the student ID is missing.\n";

describe("prepareChangeset: a writer's edit", () => {
  it("a fix bumps the patch version and leaves provenance alone", async () => {
    const p = await prepareChangeset(
      input({
        ops: [edit(RETURNING, (s) => s.replace("Search Salesforce", "Search in Salesforce"))],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(p.decision.review).toBe(false);
    expect(p.finalOps.map((o) => o.path)).toEqual([RETURNING]);
    const { data, text: out } = put(p, RETURNING);
    expect(data.version).toBe("1.2.1");
    expect(data.generated).toEqual({ by: "human:mreyes", at: "2026-09-02T08:15:00Z" });
    expect(data.verified).toHaveLength(1);
    expect(out).toContain("audience: all-staff"); // unknown keys survive
    expect(p.title).toBe('update "Enroll a returning student in Salesforce"');
    expect(p.facts.namespaces).toEqual(["admissions"]);
  });

  it("an addition bumps the minor version and records who made it", async () => {
    const p = await prepareChangeset(
      input({
        changeClass: "addition",
        ops: [edit(RETURNING, addLine)],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    const { data } = put(p, RETURNING);
    expect(data.version).toBe("1.3.0");
    expect(data.generated).toEqual({ by: "human:alice", at: "2026-09-24T00:00:00Z" });
    expect(data.verified).toHaveLength(1);
  });

  it("a process change bumps the major version, resets verification, and writes the log", async () => {
    const p = await prepareChangeset(
      input({
        changeClass: "process",
        summary: "Returning students now keep their old email.",
        ops: [edit(RETURNING, addLine)],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(p.finalOps.map((o) => o.path).sort()).toEqual([RETURNING, "kb/admissions/log.md"]);
    const { data } = put(p, RETURNING);
    expect(data.version).toBe("2.0.0");
    expect(data.verified).toBeUndefined();
    expect(data.stale_after).toBeUndefined();
    expect(put(p, "kb/admissions/log.md").text).toContain(
      "- Process change: [Enroll a returning student in Salesforce](/admissions/enroll-a-returning-student-in-salesforce.md) 1.2.0 to 2.0.0 by human:alice. Returning students now keep their old email.",
    );
  });

  it("ticking verified adds the writer's verification and a review date", async () => {
    const p = await prepareChangeset(
      input({
        changeClass: "process",
        verify: true,
        ops: [edit(RETURNING, addLine)],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    const { data } = put(p, RETURNING);
    expect(data.verified).toEqual([{ by: "human:alice", at: "2026-09-24T00:00:00Z" }]);
    expect(data.stale_after).toBe("2027-03-23T00:00:00Z"); // How-To: 180 days
  });

  it("the result lints clean as a whole vault", async () => {
    const p = await prepareChangeset(
      input({
        changeClass: "process",
        verify: true,
        ops: [edit(RETURNING, addLine)],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    const after = await loadVault(new OverlaySource(src, p.finalOps));
    expect((await lint(after, { now: NOW })).errors).toBe(0);
  });

  it("ignores a version, verification, or id written into the submitted text", async () => {
    const p = await prepareChangeset(
      input({
        ops: [
          edit(RETURNING, (s) =>
            addLine(s)
              .replace("version: 1.2.0", "version: 9.9.9")
              .replace("id: kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D", "id: kb_01J9ZMXMAFWYF33VJ7RFE28J4D")
              .replace(
                "by: human:mreyes, at: 2026-09-02T08:15:00Z }\nstale",
                "by: human:mreyes, at: 2026-09-02T08:15:00Z }\n  - { by: human:ceo, at: 2026-09-23T00:00:00Z }\nstale",
              ),
          ),
        ],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    const { data } = put(p, RETURNING);
    expect(data.version).toBe("1.2.1");
    expect(data.id).toBe("kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D");
    expect(data.verified).toEqual([{ by: "human:mreyes", at: "2026-09-02T08:15:00Z" }]);
  });
});

describe("prepareChangeset: conflicts", () => {
  it("is conflicted when a file changed after the draft was made", async () => {
    const p = await prepareChangeset(
      input({ ops: [edit(RETURNING, addLine)], baseShas: { [RETURNING]: "0".repeat(40) } }),
      context("alice", src),
    );
    expect(p.status).toBe("conflicted");
    expect(p.conflicts).toEqual([RETURNING]);
    expect(p.finalOps).toEqual([]);
  });

  it("is conflicted when a new note's path was taken in the meantime", async () => {
    const p = await prepareChangeset(
      input({ ops: [edit(STATUS, addLine)], baseShas: { [STATUS]: null } }),
      context("alice", src),
    );
    expect(p.status).toBe("conflicted");
  });

  it("other files may have changed", async () => {
    const moved = src.apply([edit(REFUND, (s) => s + "\nUnrelated edit.\n")]);
    const p = await prepareChangeset(
      input({ ops: [edit(RETURNING, addLine)], baseShas: base(RETURNING) }),
      context("alice", moved),
    );
    expect(p.status).toBe("ready");
  });
});

describe("prepareChangeset: suggestions and approval", () => {
  let suggestion: Prepared;
  beforeAll(async () => {
    suggestion = await prepareChangeset(
      input({
        source: "suggest",
        actor: "human:carol",
        verify: true,
        ops: [edit(RETURNING, addLine)],
        baseShas: base(RETURNING),
      }),
      context("carol", src),
    );
  });

  it("a reader's suggestion goes to review, for a writer to approve", () => {
    expect(suggestion.status).toBe("ready");
    expect(suggestion.decision.review).toBe(true);
    expect(suggestion.decision.reasons.map((r) => r.rule)).toEqual([1]);
    expect(suggestion.decision.approverLevel).toBe("write");
  });

  it("a reader's tick does not verify the note", () => {
    expect(put(suggestion, RETURNING).data.verified).toEqual([
      { by: "human:mreyes", at: "2026-09-02T08:15:00Z" },
    ]);
  });

  it("approval counts as the reviewer's verification", async () => {
    const p = await prepareChangeset(
      input({
        source: "suggest",
        actor: "human:carol",
        approvedBy: "human:alice",
        ops: [edit(RETURNING, addLine)],
        baseShas: base(RETURNING),
      }),
      context("carol", src),
    );
    const { data } = put(p, RETURNING);
    expect(data.verified).toEqual([
      { by: "human:mreyes", at: "2026-09-02T08:15:00Z" },
      { by: "human:alice", at: "2026-09-24T00:00:00Z" },
    ]);
  });

  it("nobody writes where they cannot read", async () => {
    const p = await prepareChangeset(
      input({
        actor: "human:carol",
        source: "suggest",
        ops: [edit("kb/people-ops/leave-policy.md", addLine)],
      }),
      context("carol", src),
    );
    expect(p.status).toBe("forbidden");
    expect(p.refusal).toContain("people-ops");
    expect(p.finalOps).toEqual([]);
  });
});

describe("prepareChangeset: repair and validation", () => {
  it("converts pasted wikilinks and replaces aliases with canonical terms", async () => {
    const p = await prepareChangeset(
      input({
        ops: [
          edit(
            STATUS,
            (s) =>
              s.replace("tags: [applications]", "tags: [applications, re-enrollment]") +
              "\nSee [[Enroll a new student]].\n",
          ),
        ],
        baseShas: base(STATUS),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    const { data, text: out } = put(p, STATUS);
    expect(out).toContain("[Enroll a new student](/admissions/enroll-a-new-student.md)");
    expect(out).not.toContain("[[");
    expect(data.tags).toEqual(["applications", "returning-students"]);
  });

  it("a person fixes validation errors before anything is saved", async () => {
    const p = await prepareChangeset(
      input({
        ops: [edit(STATUS, (s) => s.replace("themes: [enrollment]", "themes: [made-up-theme]"))],
        baseShas: base(STATUS),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("invalid");
    expect(p.issues.filter((i) => i.severity === "error").map((i) => i.rule)).toContain(
      "lore/vocabulary",
    );
    expect(p.refusal).toMatch(/to fix before this can be saved/);
  });

  it("AI output with errors left after repair goes to a reviewer instead", async () => {
    const p = await prepareChangeset(
      input({
        source: "upload",
        aiDrafted: true,
        actor: "lore-ingest/claude-sonnet-5",
        ops: [edit(STATUS, (s) => s.replace("themes: [enrollment]", "themes: [made-up-theme]"))],
        baseShas: base(STATUS),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(p.decision.reasons.map((r) => r.code)).toContain("validation");
  });

  it("refuses secrets", async () => {
    const p = await prepareChangeset(
      input({
        ops: [
          edit(
            STATUS,
            (s) =>
              s + "\nConnect with postgres://admin:hunter2secret@db.internal.example:5432/app\n",
          ),
        ],
        baseShas: base(STATUS),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("invalid");
    expect(p.issues.map((i) => i.rule)).toContain("lore/secrets");
  });

  it("problems elsewhere in the vault do not block an unrelated edit", async () => {
    const broken = src.apply([
      edit(REFUND, (s) => s.replace(/^themes: .*$/m, "themes: [made-up-theme]")),
    ]);
    const p = await prepareChangeset(
      input({
        ops: [edit(RETURNING, addLine)],
        baseShas: { [RETURNING]: gitBlobSha(text(RETURNING)) },
      }),
      context("alice", broken),
    );
    expect(p.status).toBe("ready");
  });

  it("a change that changes nothing is refused", async () => {
    const p = await prepareChangeset(
      input({ ops: [edit(RETURNING, (s) => s)], baseShas: base(RETURNING) }),
      context("alice", src),
    );
    expect(p.status).toBe("invalid");
    expect(p.refusal).toBe("The changeset changes nothing");
  });
});

describe("prepareChangeset: new notes", () => {
  const body = (front: string) =>
    `---\ntype: How-To\ntitle: Defer an enrollment\ndescription: Move an accepted student's start to a later term.\n${front}themes: [enrollment]\n---\n\n# Steps\n\n1. Open the enrollment.\n\n# Related\n\n- [Enrollment](/_themes/enrollment.md)\n`;
  const path = "kb/admissions/defer-an-enrollment.md";

  it("gets an id, a version, and provenance", async () => {
    const p = await prepareChangeset(
      input({
        changeClass: "addition",
        ops: [{ op: "put", path, content: body("") }],
        baseShas: { [path]: null },
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(p.decision.review).toBe(false);
    const { data } = put(p, path);
    expect(data.id).toBe("kb_01K00000000000000000000001");
    expect(data.version).toBe("1.0.0");
    expect(data.generated).toEqual({ by: "human:alice", at: "2026-09-24T00:00:00Z" });
    expect(p.title).toBe('add "Defer an enrollment"');
  });

  it("a draft starts at 0.1.0, and cannot arrive already verified", async () => {
    const p = await prepareChangeset(
      input({
        ops: [
          {
            op: "put",
            path,
            content: body(
              "status: draft\nverified: [{ by: human:ceo, at: 2026-01-01T00:00:00Z }]\n",
            ),
          },
        ],
      }),
      context("alice", src),
    );
    const { data } = put(p, path);
    expect(data.version).toBe("0.1.0");
    expect(data.verified).toBeUndefined();
  });

  it("publishing a draft makes it 1.0.0", async () => {
    const draft = "kb/admissions/manage-the-course-waitlist.md";
    const p = await prepareChangeset(
      input({
        changeClass: "addition",
        ops: [edit(draft, (s) => s.replace("status: draft\n", ""))],
        baseShas: base(draft),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(put(p, draft).data.version).toBe("1.0.0");
  });

  it("images are committed beside the note", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const p = await prepareChangeset(
      input({
        changeClass: "addition",
        ops: [
          { op: "put", path: "kb/admissions/_assets/steps.png", content: png },
          edit(RETURNING, (s) => s + "\n![The steps](/admissions/_assets/steps.png)\n"),
        ],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(p.finalOps.map((o) => o.path).sort()).toEqual([
      "kb/admissions/_assets/steps.png",
      RETURNING,
    ]);
    expect(p.facts.assets).toEqual(["kb/admissions/_assets/steps.png"]);
  });
});

describe("prepareChangeset: intents", () => {
  it("a rename rewrites inbound links in the same changeset, without bumping other notes", async () => {
    const to = "kb/admissions/re-enroll-a-student.md";
    const p = await prepareChangeset(
      input({ intents: [{ type: "move", from: RETURNING, to }] }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(p.decision.review).toBe(false);
    expect(p.title).toBe('move "Enroll a returning student in Salesforce"');
    const paths = p.finalOps.map((o) => o.path);
    expect(paths).toContain(to);
    expect(p.finalOps.find((o) => o.path === RETURNING)?.op).toBe("delete");
    const linking = p.facts.notes.filter((n) => !n.primary);
    expect(linking.length).toBeGreaterThan(0);
    for (const n of linking) {
      const { data, text: out } = put(p, n.to!);
      expect(out).toContain("/admissions/re-enroll-a-student.md");
      expect(data.version ?? null).toBe(n.versionBefore);
    }
    const after = await loadVault(new OverlaySource(src, p.finalOps));
    const report = await lint(after, { now: NOW });
    expect(report.errors).toBe(0);
    expect(
      report.issues.filter(
        (i) => i.rule === "lore/link-targets" && i.message.includes("re-enroll"),
      ),
    ).toEqual([]);
  });

  it("a move to another namespace needs a maintainer", async () => {
    const p = await prepareChangeset(
      input({
        actor: "human:dana",
        intents: [
          { type: "move", from: RETURNING, to: "kb/finance/enroll-a-returning-student.md" },
        ],
      }),
      context("dana", src),
    );
    expect(p.decision.reasons.map((r) => r.code)).toEqual(["destructive"]);
    expect(p.decision.approverLevel).toBe("maintain");
    expect(p.facts.namespaces).toEqual(["admissions", "finance"]);
  });

  it("deleting and deprecating need a maintainer", async () => {
    const del = await prepareChangeset(
      input({ intents: [{ type: "delete", path: STATUS }] }),
      context("alice", src),
    );
    expect(del.status).toBe("ready");
    expect(del.decision.reasons.map((r) => r.code)).toEqual(["destructive"]);
    expect(del.title).toBe(`delete "Check an application's status"`);

    const dep = await prepareChangeset(
      input({
        intents: [
          { type: "deprecate", path: STATUS, supersededBy: "/admissions/enroll-a-new-student.md" },
        ],
      }),
      context("alice", src),
    );
    expect(dep.status).toBe("ready");
    expect(put(dep, STATUS).data).toMatchObject({
      status: "deprecated",
      superseded_by: "/admissions/enroll-a-new-student.md",
      version: "1.0.1",
    });
    expect(dep.decision.reasons.map((r) => r.code)).toEqual(["destructive"]);
  });

  it("Mark verified adds a verification without touching the version", async () => {
    const unverified = "kb/finance/accrue-unbilled-revenue.md";
    const before = parseNote(text(unverified), unverified).data;
    const p = await prepareChangeset(
      input({ actor: "human:bob", intents: [{ type: "verify", path: unverified }] }),
      context("bob", src),
    );
    expect(p.status).toBe("ready");
    expect(p.decision.review).toBe(false);
    const { data } = put(p, unverified);
    expect(data.version).toBe(before.version);
    expect((data.verified as unknown[]).at(-1)).toEqual({
      by: "human:bob",
      at: "2026-09-24T00:00:00Z",
    });
  });

  it("agents cannot verify", async () => {
    const p = await prepareChangeset(
      input({
        actor: "claude-code/claude-sonnet-5",
        source: "agent",
        aiDrafted: true,
        intents: [{ type: "verify", path: STATUS }],
      }),
      context("alice", src),
    );
    expect(p.status).toBe("invalid");
    expect(p.refusal).toMatch(/Only people can verify/);
  });

  it("merging tags is one changeset that leaves the vault lint-clean", async () => {
    const vault = await loadVault(src);
    const [a, b] = Object.keys(vault.tags);
    const p = await prepareChangeset(
      input({
        actor: "human:bob",
        intents: [{ type: "merge_terms", kind: "tag", from: [a!], into: b! }],
      }),
      context("bob", src),
    );
    expect(p.status).toBe("ready");
    expect(p.title).toBe(`merge tag "${a}" into "${b}"`);
    expect(p.decision.review).toBe(true);
    expect(p.decision.approverLevel).toBe("maintain");
    expect(p.facts.terms).toEqual([{ kind: "tag", slug: a, change: "removed" }]);
    const after = await loadVault(new OverlaySource(src, p.finalOps));
    expect((await lint(after, { now: NOW })).errors).toBe(0);
  });
});

describe("prepareChangeset: paths", () => {
  it.each([
    ["kb/admissions/index.md", /generated/],
    ["kb/admissions/log.md", /generated/],
    ["kb/_meta/graph.json", /generated/],
    ["README.md", /outside the vault/],
    [".github/workflows/kb.yml", /outside the vault/],
    ["kb/admissions/../../.github/x.md", /not a valid path/],
    ["/etc/passwd", /not a valid path/],
    [".kb/profile.yaml", /Only admins/],
    [".kb/namespaces.yaml", /Only admins/],
  ])("refuses %s", async (path, why) => {
    const p = await prepareChangeset(
      input({ ops: [{ op: "put", path, content: "x" }] }),
      context("alice", src),
    );
    expect(p.status).toBe("forbidden");
    expect(p.refusal).toMatch(why);
    expect(p.finalOps).toEqual([]);
  });
});

describe("prepareChangeset: edits from the form", () => {
  it("changes the body and chosen keys, leaving every other byte alone", async () => {
    const before = text(RETURNING);
    const body = parseNote(before, RETURNING).body;
    const p = await prepareChangeset(
      input({
        changeClass: "addition",
        intents: [
          {
            type: "edit",
            path: RETURNING,
            body: body + "\nAsk the registrar if the student ID is missing.\n",
            set: {
              description: "Reactivate a former student and open a new enrollment.",
              tags: ["returning-students"],
            },
            unset: ["resource"],
          },
        ],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(p.decision.review).toBe(false);
    const { data, text: out } = put(p, RETURNING);
    expect(data).toMatchObject({
      description: "Reactivate a former student and open a new enrollment.",
      tags: ["returning-students"],
      version: "1.3.0",
      audience: "all-staff",
    });
    expect(data.resource).toBeUndefined();
    expect(out).toContain("owner: admissions-ops\naliases: [re-enroll a student");
    expect(out).toContain(
      "  - { id: sis-sop, resource: /admissions/references/sis-enrollment-sop-2025.md",
    );
    expect(out.endsWith("Ask the registrar if the student ID is missing.\n")).toBe(true);
  });

  it("a form cannot set the keys the pipeline owns", async () => {
    const p = await prepareChangeset(
      input({
        intents: [
          {
            type: "edit",
            path: RETURNING,
            set: {
              title: "Re-enroll a returning student",
              id: "kb_01J9ZMXMAFWYF33VJ7RFE28J4D",
              version: "9.9.9",
              verified: [{ by: "human:ceo", at: "2026-09-23T00:00:00Z" }],
            },
            unset: ["generated", "stale_after"],
          },
        ],
        baseShas: base(RETURNING),
      }),
      context("alice", src),
    );
    const { data } = put(p, RETURNING);
    expect(data).toMatchObject({
      title: "Re-enroll a returning student",
      id: "kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D",
      version: "1.2.1",
      stale_after: "2027-03-01T08:15:00Z",
    });
    expect(data.verified).toEqual([{ by: "human:mreyes", at: "2026-09-02T08:15:00Z" }]);
  });

  it("editing a hub keeps its generated member list", async () => {
    const hub = "kb/_themes/onboarding.md";
    const before = text(hub);
    expect(before).toContain("/people-ops/");
    const p = await prepareChangeset(
      input({
        actor: "human:bob",
        changeClass: "addition",
        intents: [
          {
            type: "edit",
            path: hub,
            body: "# Overview\n\nNew hires and new students start here.\n",
          },
        ],
        baseShas: base(hub),
      }),
      context("bob", src),
    );
    expect(p.status).toBe("ready");
    const { text: out } = put(p, hub);
    expect(out).toContain("New hires and new students start here.");
    const block = (s: string) =>
      s.slice(s.indexOf("<!-- kb:members:start -->"), s.indexOf("<!-- kb:members:end -->"));
    expect(block(out)).toBe(block(before));
    expect(out.match(/kb:members:start/g)).toHaveLength(1);
  });

  it("creates a note from a form", async () => {
    const p = await prepareChangeset(
      input({
        changeClass: "addition",
        intents: [
          {
            type: "create",
            namespace: "admissions",
            data: {
              type: "How-To",
              title: "Defer an enrollment",
              description: "Move an accepted student's start to a later term.",
              themes: ["enrollment"],
              systems: [],
              id: "kb_forged",
            },
            body: "# Steps\n\n1. Open the enrollment.\n\n# Related\n\n- [Enrollment](/_themes/enrollment.md)\n",
          },
        ],
      }),
      context("alice", src),
    );
    expect(p.status).toBe("ready");
    expect(p.title).toBe('add "Defer an enrollment"');
    const { data, text: out } = put(p, "kb/admissions/defer-an-enrollment.md");
    expect(data.id).toBe("kb_01K00000000000000000000001");
    expect(data.version).toBe("1.0.0");
    expect(data.systems).toBeUndefined();
    expect(out.startsWith("---\ntype: How-To\ntitle: Defer an enrollment\n")).toBe(true);
  });

  it.each([
    [{ namespace: "nowhere" }, /Unknown namespace/],
    [{ folder: "../finance" }, /not a valid folder/],
    [
      { data: { type: "How-To", title: "Enroll a new student", themes: ["enrollment"] } },
      /already exists/,
    ],
    [{ data: { type: "How-To", themes: ["enrollment"] } }, /needs a title/],
  ])("refuses to create %j", async (over, why) => {
    const p = await prepareChangeset(
      input({
        intents: [
          {
            type: "create",
            namespace: "admissions",
            data: { type: "How-To", title: "A new one", description: "x.", themes: ["enrollment"] },
            body: "# Steps\n",
            ...over,
          },
        ],
      }),
      context("alice", src),
    );
    expect(p.status).toBe("invalid");
    expect(p.refusal).toMatch(why);
  });
});

describe("prepareChangeset: namespaces and teams", () => {
  it("an admin changes a namespace's settings, as one commit to the registry", async () => {
    const p = await prepareChangeset(
      input({
        actor: "human:dana",
        intents: [{ type: "set_namespace", slug: "finance", patch: { visibility: "restricted" } }],
      }),
      context("dana", src),
    );
    expect(p.status).toBe("ready");
    expect(p.decision.review).toBe(false);
    expect(p.finalOps.map((o) => o.path)).toEqual([".kb/namespaces.yaml"]);
    expect(p.title).toBe('change the settings of namespace "finance"');
    expect(p.facts.namespaces).toEqual([]);
  });

  it("a new namespace is reviewed, like any new term", async () => {
    const p = await prepareChangeset(
      input({
        actor: "human:dana",
        intents: [{ type: "set_namespace", slug: "legal", patch: { title: "Legal" } }],
      }),
      context("dana", src),
    );
    expect(p.status).toBe("ready");
    expect(p.title).toBe('add namespace "legal"');
    expect(p.decision.reasons.map((r) => r.code)).toEqual(["new-term"]);
  });

  const adminOnly: ChangesetIntent[] = [
    { type: "set_namespace", slug: "finance", patch: { visibility: "company" } },
    { type: "set_teams", teams: ["a-team"] },
  ];
  it.each(adminOnly)("only admins can: %j", async (intent) => {
    for (const who of ["alice", "bob"] as const) {
      const p = await prepareChangeset(
        input({ actor: `human:${who}`, intents: [intent] }),
        context(who, src),
      );
      expect(p.status).toBe("forbidden");
      expect(p.refusal).toBe("Only admins change namespaces and teams");
    }
  });
});
