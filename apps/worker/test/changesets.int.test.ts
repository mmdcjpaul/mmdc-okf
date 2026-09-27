import { execFileSync } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getNote, listNotifications, openFlags } from "@lore/db";
import { parseNote } from "@lore/okf";
import { createHarness, servicesAvailable, type Harness } from "./harness.ts";

await servicesAvailable();

const ALL = (h: Harness) => ({
  vaultId: h.vaultId,
  namespaces: ["admissions", "finance", "it-support", "people-ops"],
});
const RETURNING = "kb/admissions/enroll-a-returning-student-in-salesforce.md";
const RETURNING_ID = "kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D";
const STATUS = "kb/admissions/check-an-applications-status.md";
const addLine = (line: string) => (s: string) => `${s}\n${line}\n`;

const log = (h: Harness, format: string, ref = "main") =>
  execFileSync("git", ["--git-dir", h.bare, "log", "-1", `--format=${format}`, ref], {
    encoding: "utf8",
  }).trim();

describe("a writer's edit", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness("cs-edit");
    await h.index();
  });
  afterAll(() => h?.close());

  it("lands as one commit with the fixed message, crediting the person", async () => {
    const { cs, outcome } = await h.submit({
      by: "alice",
      changeClass: "addition",
      edit: { [RETURNING]: addLine("Ask the registrar if the student ID is missing.") },
    });
    expect(outcome.state).toBe("committed");
    expect(cs.state).toBe("committed");
    expect(cs.commitSha).toBe(log(h, "%H"));
    expect(log(h, "%B")).toBe(
      [
        'kb(admissions): update "Enroll a returning student in Salesforce"',
        "",
        "Change-Class: addition",
        `Changeset: ${cs.id}`,
        "Source: library-editor",
        "Co-authored-by: Alice Reyes <alice@acme.test>",
      ].join("\n"),
    );
    expect(log(h, "%an")).toBe("Lore");
    const files = execFileSync(
      "git",
      ["--git-dir", h.bare, "show", "--name-only", "--format=", "main"],
      { encoding: "utf8" },
    ).trim();
    expect(files).toBe(RETURNING);
  });

  it("shows the new version once indexed, with the change class from the trailer", async () => {
    await h.index();
    const note = await getNote(h.db, ALL(h), RETURNING_ID);
    expect(note?.version).toBe("1.3.0");
    expect(note?.lastChangedBy).toBe("Lore");
    const sql = h.db.$client;
    const [row] = await sql`
      select change_class from note_commits
      where vault_id = ${h.vaultId} and note_id = ${RETURNING_ID}
      order by committed_at desc limit 1`;
    expect(row!.change_class).toBe("addition");
  });

  it("records the commit in the audit log", async () => {
    const [row] = await h.db.$client`
      select actor_id, metadata from audit_log where action = 'changeset.commit'
      order by id desc limit 1`;
    expect(row!.actor_id).toBe("alice");
    expect(row!.metadata).toMatchObject({ source: "editor", namespaces: ["admissions"] });
  });

  it("does nothing when asked to process the same changeset again", async () => {
    const { cs } = await h.submit({ by: "alice", edit: { [STATUS]: addLine("One more line.") } });
    const head = log(h, "%H");
    const { processChangeset } = await import("../src/changesets/process.ts");
    expect(await processChangeset(h.changesets, cs.id)).toEqual({
      state: "skipped",
      reason: "Changeset is committed",
    });
    expect(log(h, "%H")).toBe(head);
  });

  it("goes back to the writer with what to fix when it does not validate", async () => {
    const head = log(h, "%H");
    const { cs, outcome } = await h.submit({
      by: "alice",
      edit: { [STATUS]: (s) => s.replace("themes: [enrollment]", "themes: [made-up]") },
    });
    expect(outcome.state).toBe("draft");
    expect(cs.state).toBe("draft");
    expect(cs.issues.map((i) => i.rule)).toContain("lore/vocabulary");
    expect(cs.error).toMatch(/to fix/);
    expect(log(h, "%H")).toBe(head);
  });

  it("refuses a write outside the vault and records it", async () => {
    const head = log(h, "%H");
    const { cs } = await h.submit({
      by: "alice",
      ops: [{ op: "put", path: ".github/workflows/x.yml", content: "on: push" }],
    });
    expect(cs.state).toBe("rejected");
    expect(log(h, "%H")).toBe(head);
    const [row] = await h.db.$client`
      select action from audit_log where target = ${cs.id}`;
    expect(row!.action).toBe("changeset.refused");
  });
});

describe("a reader's suggestion", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness("cs-suggest");
    await h.index();
  });
  afterAll(() => h?.close());

  it("waits in review, then commits crediting both people, verified by the approver", async () => {
    const head = log(h, "%H");
    const { cs, outcome } = await h.submit({
      by: "carol",
      source: "suggest",
      reason: "The registrar asked for this.",
      edit: { [RETURNING]: addLine("Ask the registrar if the student ID is missing.") },
    });
    expect(outcome.state).toBe("in_review");
    expect(cs.reviewReasons.map((r) => r.rule)).toEqual([1]);
    expect(cs.approverLevel).toBe("write");
    expect(cs.namespaces).toEqual(["admissions"]);
    expect(cs.noteIds).toEqual([RETURNING_ID]);
    expect(log(h, "%H")).toBe(head);

    const approved = await h.approve(cs.id, "alice");
    expect(approved.outcome.state).toBe("committed");
    const message = log(h, "%B");
    expect(message).toContain("The registrar asked for this.");
    expect(message).toContain("Source: library-suggestion");
    expect(message).toContain("Co-authored-by: Carol Diaz <carol@acme.test>");
    expect(message).toContain("Co-authored-by: Alice Reyes <alice@acme.test>");

    const verified = parseNote((await h.read(RETURNING))!, RETURNING).data.verified as {
      by: string;
    }[];
    expect(verified.map((v) => v.by)).toEqual(["human:mreyes", "human:alice"]);
  });

  it("is conflicted when the note changed while it waited", async () => {
    const { cs } = await h.submit({
      by: "carol",
      source: "suggest",
      reason: "Clearer.",
      edit: { [STATUS]: addLine("A suggestion.") },
    });
    expect(cs.state).toBe("in_review");
    await h.submit({ by: "alice", edit: { [STATUS]: addLine("Alice got there first.") } });
    const head = log(h, "%H");
    const { cs: after, outcome } = await h.approve(cs.id, "alice");
    expect(outcome.state).toBe("conflicted");
    expect(after.conflicts).toEqual([STATUS]);
    expect(log(h, "%H")).toBe(head);
  });
});

describe("concurrent writers", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness("cs-concurrent");
    await h.index();
  });
  afterAll(() => h?.close());

  it("two changesets on the same head both land when their files do not overlap", async () => {
    const a = await h.save({ by: "alice", edit: { [RETURNING]: addLine("From A.") } });
    const b = await h.save({ by: "alice", edit: { [STATUS]: addLine("From B.") } });
    const { processChangeset } = await import("../src/changesets/process.ts");
    const [ra, rb] = await Promise.all([
      processChangeset(h.changesets, a.id),
      processChangeset(h.changesets, b.id),
    ]);
    expect([ra.state, rb.state]).toEqual(["committed", "committed"]);
    expect(await h.read(RETURNING)).toContain("From A.");
    expect(await h.read(STATUS)).toContain("From B.");
    const count = execFileSync("git", ["--git-dir", h.bare, "rev-list", "--count", "main"], {
      encoding: "utf8",
    }).trim();
    expect(count).toBe("3");
  });

  it("the second is conflicted when they change the same file", async () => {
    const a = await h.save({ by: "alice", edit: { [RETURNING]: addLine("First writer.") } });
    const b = await h.save({ by: "alice", edit: { [RETURNING]: addLine("Second writer.") } });
    const { processChangeset } = await import("../src/changesets/process.ts");
    const results = await Promise.all([
      processChangeset(h.changesets, a.id),
      processChangeset(h.changesets, b.id),
    ]);
    expect(results.map((r) => r.state).sort()).toEqual(["committed", "conflicted"]);
    const text = (await h.read(RETURNING))!;
    expect(text.includes("First writer.") !== text.includes("Second writer.")).toBe(true);
  });

  it("a push from outside to another file does not block a changeset", async () => {
    const cs = await h.save({ by: "alice", edit: { [STATUS]: addLine("After the push.") } });
    const file = join(h.work, "kb/finance/refund-policy.md");
    await writeFile(file, (await readFile(file, "utf8")) + "\nPushed from Obsidian.\n");
    // The working copy is behind the branch, so commit only that file on top of the head.
    execFileSync("git", ["--git-dir", h.bare, "symbolic-ref", "HEAD", "refs/heads/main"]);
    const blob = execFileSync("git", ["--git-dir", h.bare, "hash-object", "-w", file], {
      encoding: "utf8",
    }).trim();
    const env = {
      ...process.env,
      GIT_INDEX_FILE: join(h.work, "../index-push"),
      GIT_AUTHOR_NAME: "External",
      GIT_AUTHOR_EMAIL: "e@acme.test",
      GIT_COMMITTER_NAME: "External",
      GIT_COMMITTER_EMAIL: "e@acme.test",
    };
    const git = (...args: string[]) =>
      execFileSync("git", ["--git-dir", h.bare, ...args], { encoding: "utf8", env }).trim();
    const head = git("rev-parse", "main");
    git("read-tree", head);
    git("update-index", "--add", "--cacheinfo", `100644,${blob},kb/finance/refund-policy.md`);
    const commit = execFileSync(
      "git",
      ["--git-dir", h.bare, "commit-tree", git("write-tree"), "-p", head, "-m", "Outside edit"],
      { encoding: "utf8", env },
    ).trim();
    git("update-ref", "refs/heads/main", commit, head);

    const { processChangeset } = await import("../src/changesets/process.ts");
    expect((await processChangeset(h.changesets, cs.id)).state).toBe("committed");
    expect(await h.read(STATUS)).toContain("After the push.");
    expect(await h.read("kb/finance/refund-policy.md")).toContain("Pushed from Obsidian.");
  });
});

describe("a process change", () => {
  let h: Harness;
  const NEW_STUDENT = "kb/admissions/enroll-a-new-student.md";
  beforeAll(async () => {
    h = await createHarness("cs-process");
    await h.indexWithEffects();
  });
  afterAll(() => h?.close());

  async function expectEffects(noteId: string, by: string) {
    const note = await getNote(h.db, ALL(h), noteId);
    expect(note?.processChangedAt).toBeInstanceOf(Date);
    // Owners are told, in the app.
    const owners = await listNotifications(h.db, "alice", h.vaultId);
    const told = owners.filter((n) => n.kind === "process_change" && n.href?.includes(noteId));
    expect(told).toHaveLength(1);
    expect(told[0]!.title).toBe(`Process changed: ${note!.title}`);
    expect(told[0]!.body).toContain(by);
    // People outside the owning team are not.
    const others = await listNotifications(h.db, "carol", h.vaultId);
    expect(others.filter((n) => n.href?.includes(noteId))).toEqual([]);
    return note!;
  }

  it("from the editor: major bump, log entry, Changed badge, owners told, linking notes flagged", async () => {
    const before = await getNote(h.db, ALL(h), RETURNING_ID);
    expect(before?.processChangedAt).toBeNull();
    const { cs } = await h.submit({
      by: "alice",
      changeClass: "process",
      summary: "Returning students now keep their old email.",
      edit: { [RETURNING]: addLine("Keep the student's old email address.") },
    });
    expect(cs.state).toBe("committed");
    const effects = await h.indexWithEffects();
    expect(effects.notified).toBeGreaterThan(0);
    expect(effects.flagged).toBeGreaterThan(0);

    const note = await expectEffects(RETURNING_ID, "Lore");
    expect(note.version).toBe("2.0.0");
    expect(note.trustTier).toBe("unverified"); // earlier confirmations were about other content
    expect(await h.read("kb/admissions/log.md")).toContain(
      "1.2.0 to 2.0.0 by human:alice. Returning students now keep their old email.",
    );

    const linking = await h.db.$client`
      select n.path from note_flags f join notes n on n.vault_id = f.vault_id and n.id = f.note_id
      where f.vault_id = ${h.vaultId} and f.cause_note_id = ${RETURNING_ID} and f.cleared_at is null
      order by n.path`;
    expect(linking.length).toBeGreaterThan(0);
    const flagged = await getNote(
      h.db,
      ALL(h),
      (
        await h.db.$client`
        select note_id from note_flags where vault_id = ${h.vaultId} limit 1`
      )[0]!.note_id,
    );
    const flags = await openFlags(h.db, h.vaultId, flagged!.id);
    expect(flags[0]).toMatchObject({ causeNoteId: RETURNING_ID });
  });

  it("from a push outside Lore: exactly the same effects", async () => {
    const id = parseNote((await h.read(NEW_STUDENT))!, NEW_STUDENT).data.id as string;
    const file = join(h.work, NEW_STUDENT);
    // Bring the working copy up to the branch first, then edit as Obsidian would.
    execFileSync("git", ["--git-dir", h.bare, "--work-tree", h.work, "checkout", "-f", "main"]);
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        /^version: (\d+)\.\d+\.\d+$/m,
        (_m, major) => `version: ${Number(major) + 1}.0.0`,
      ) + "\nCheck the waitlist first.\n",
    );
    expect(
      await h.push("Check the waitlist first", { name: "Maria Reyes", email: "mreyes@acme.test" }),
    ).not.toBeNull();
    const effects = await h.indexWithEffects();
    expect(effects.notified).toBeGreaterThan(0);
    expect(effects.flagged).toBeGreaterThan(0);
    await expectEffects(id, "Maria Reyes");
  });

  it("does not notify twice for the same change", async () => {
    const before = (await listNotifications(h.db, "alice", h.vaultId)).length;
    await h.indexWithEffects();
    expect((await listNotifications(h.db, "alice", h.vaultId)).length).toBe(before);
  });

  it("clears a note's flag once that note is changed", async () => {
    const [row] = await h.db.$client`
      select f.note_id, n.path from note_flags f
      join notes n on n.vault_id = f.vault_id and n.id = f.note_id
      where f.vault_id = ${h.vaultId} and f.cleared_at is null and n.namespace = 'admissions'
      limit 1`;
    const { cs } = await h.submit({
      by: "alice",
      edit: { [row!.path]: addLine("Updated to match the new process.") },
    });
    expect(cs.state).toBe("committed");
    await h.indexWithEffects();
    expect(await openFlags(h.db, h.vaultId, row!.note_id)).toEqual([]);
  });
});
