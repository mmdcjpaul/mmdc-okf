import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideTerm, type ChangesetIntent } from "@lore/changesets";
import { getChangeset, listTerms, transitionChangeset, updateChangeset } from "@lore/db";
import { GitTreeSource } from "@lore/git";
import { lint, loadVault, parseNote } from "@lore/okf";
import { processChangeset } from "../src/changesets/process.ts";
import { mirrorFor } from "../src/runtime.ts";
import { createHarness, NOW, servicesAvailable, type Harness } from "./harness.ts";

await servicesAvailable();

const git = (h: Harness, ...args: string[]) =>
  execFileSync("git", ["--git-dir", h.bare, ...args], { encoding: "utf8" }).trim();

/** Lint errors in the vault as committed. */
async function errorsAtHead(h: Harness): Promise<string[]> {
  const mirror = mirrorFor(`local:${h.bare}`);
  const head = (await mirror.resolve("refs/heads/main"))!;
  const vault = await loadVault(await new GitTreeSource(mirror, head).load(["kb/", ".kb/"]));
  const report = await lint(vault, { now: NOW });
  return report.issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`);
}

const note = (title: string, extra: Record<string, unknown> = {}): ChangesetIntent => ({
  type: "create",
  namespace: "finance",
  data: {
    type: "How-To",
    title,
    description: `How to ${title.toLowerCase()}.`,
    themes: ["month-end-close"],
    systems: ["netsuite"],
    tags: ["refunds"],
    ...extra,
  },
  body: "# Before you start\n\nYou need the payment reference.\n\n# Steps\n\n1. Open the record.\n2. Post the entry.\n\n# Check it worked\n\nThe entry shows in the ledger.\n",
});

describe("renames and merges", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness("taxonomy");
    await h.index();
  });
  afterAll(() => h?.close());

  it("a merge of two tags is reviewed, lands as one commit, and leaves the vault lint-clean", async () => {
    const before = Number(git(h, "rev-list", "--count", "main"));
    const { cs } = await h.submit({
      by: "bob",
      intents: [{ type: "merge_terms", kind: "tag", from: ["deposits"], into: "refunds" }],
    });
    // Merging removes a term, so a second maintainer looks at it.
    expect(cs.state).toBe("in_review");
    expect(cs.approverLevel).toBe("maintain");
    expect(cs.title).toBe('merge tag "deposits" into "refunds"');
    const { cs: done, outcome } = await h.approve(cs.id, "dana");
    expect(outcome.state).toBe("committed");
    expect(Number(git(h, "rev-list", "--count", "main"))).toBe(before + 1);
    expect(git(h, "log", "-1", "--format=%s")).toBe(
      'kb(vault): merge tag "deposits" into "refunds"',
    );

    const changed = git(h, "show", "--name-only", "--format=", done.commitSha!).split("\n");
    expect(changed).toContain(".kb/tags.yaml");
    expect(changed).toContain("kb/finance/post-an-enrollment-deposit.md");
    const deposit = parseNote(
      (await h.read("kb/finance/post-an-enrollment-deposit.md"))!,
      "kb/finance/post-an-enrollment-deposit.md",
    );
    expect(deposit.data.tags).toEqual(["refunds"]);
    // A note that had both keeps one, not two.
    const flow = parseNote(
      (await h.read("kb/finance/how-deposits-flow-from-salesforce-to-netsuite.md"))!,
      "x.md",
    );
    expect(flow.data.tags).toEqual(["refunds", "sync"]);
    expect(await errorsAtHead(h)).toEqual([]);

    await h.index();
    const tags = (await listTerms(h.db, h.vaultId)).filter((t) => t.kind === "tag");
    expect(tags.find((t) => t.slug === "deposits")).toBeUndefined();
    expect(tags.find((t) => t.slug === "refunds")!.aliases).toEqual(
      expect.arrayContaining(["refund", "deposits"]),
    );
  });

  it("a rename lands as one commit and keeps the old name as an alias", async () => {
    const { cs } = await h.submit({
      by: "bob",
      intents: [
        { type: "rename_term", kind: "tag", from: "reconciliation", to: "ledger-matching" },
      ],
    });
    expect(cs.state).toBe("in_review");
    const { outcome } = await h.approve(cs.id, "dana");
    expect(outcome.state).toBe("committed");
    expect(git(h, "log", "-1", "--format=%s")).toBe(
      'kb(vault): rename tag "reconciliation" to "ledger-matching"',
    );
    expect(await errorsAtHead(h)).toEqual([]);
    expect(await h.read("kb/finance/month-end-close-process.md")).toContain("ledger-matching");
  });

  it("someone who maintains nothing cannot change the vocabulary by themselves", async () => {
    const { cs } = await h.submit({
      by: "alice",
      intents: [{ type: "rename_term", kind: "tag", from: "payroll", to: "pay-runs" }],
    });
    expect(cs.state).toBe("in_review");
    expect(cs.reviewReasons.map((r) => r.code)).toContain("no-write-access");
  });
});

describe("proposed terms", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness("taxonomy-queue");
    await h.index();
  });
  afterAll(() => h?.close());

  const proposal = (slug: string): ChangesetIntent => ({
    type: "add_term",
    kind: "tag",
    slug,
    description: "Refunds paid by cheque.",
  });
  const decideAndRun = async (id: string, intents: ChangesetIntent[]) => {
    await transitionChangeset(h.db, id, ["in_review"], "submitted", { intents });
    const outcome = await processChangeset(h.changesets, id);
    return { cs: (await getChangeset(h.db, id))!, outcome };
  };

  it("a changeset that proposes a term waits for a maintainer", async () => {
    const { cs } = await h.submit({
      by: "bob",
      intents: [proposal("cheque-refunds"), note("Refund a cheque", { tags: ["cheque-refunds"] })],
    });
    expect(cs.state).toBe("in_review");
    expect(cs.reviewReasons.map((r) => r.code)).toEqual(["new-term"]);
    expect(cs.approverLevel).toBe("maintain");
  });

  it("accepted: the term has had its review, and a writer's own change publishes", async () => {
    const { cs } = await h.submit({
      by: "bob",
      intents: [
        proposal("bank-transfers"),
        note("Refund by transfer", { tags: ["bank-transfers"] }),
      ],
    });
    expect(cs.state).toBe("in_review");
    const { cs: after, outcome } = await decideAndRun(
      cs.id,
      decideTerm(
        cs.intents,
        { kind: "tag", slug: "bank-transfers" },
        { decision: "accept", by: "human:dana" },
      ),
    );
    expect(outcome.state).toBe("committed");
    expect(after.reviewReasons).toEqual([]);
    expect(await h.read(".kb/tags.yaml")).toContain("bank-transfers:");
    expect(await errorsAtHead(h)).toEqual([]);
  });

  it("accepted, but AI drafted it in a manual namespace: still reviewed, for that reason only", async () => {
    const { cs } = await h.submit({
      by: "bob",
      aiDrafted: true,
      source: "upload",
      actor: "ingest/claude-sonnet-5",
      intents: [proposal("wire-refunds"), note("Refund by wire", { tags: ["wire-refunds"] })],
    });
    expect(cs.reviewReasons.map((r) => r.code).sort()).toEqual(["ai-manual-namespace", "new-term"]);
    const { cs: after } = await decideAndRun(
      cs.id,
      decideTerm(
        cs.intents,
        { kind: "tag", slug: "wire-refunds" },
        { decision: "accept", by: "human:dana" },
      ),
    );
    expect(after.state).toBe("in_review");
    expect(after.reviewReasons.map((r) => r.code)).toEqual(["ai-manual-namespace"]);
    expect(after.approverLevel).toBe("write");
  });

  it("mapped to an existing term: the note uses it, and the proposed name becomes an alias", async () => {
    const { cs } = await h.submit({
      by: "bob",
      intents: [
        proposal("money-back"),
        note("Give money back", { tags: ["money-back", "deposits"] }),
      ],
    });
    const { outcome } = await decideAndRun(
      cs.id,
      decideTerm(
        cs.intents,
        { kind: "tag", slug: "money-back" },
        { decision: "alias", into: "refunds", by: "human:dana" },
      ),
    );
    // Adding another name changes the vocabulary, which Bob maintains.
    expect(outcome.state).toBe("committed");
    const written = parseNote((await h.read("kb/finance/give-money-back.md"))!, "x.md");
    expect(written.data.tags).toEqual(["refunds", "deposits"]);
    const tags = (await h.read(".kb/tags.yaml"))!;
    expect(tags).not.toMatch(/^money-back:/m);
    expect(tags).toMatch(/^refunds:.*money-back/m);
    expect(await errorsAtHead(h)).toEqual([]);
  });

  it("decided for a writer who maintains nothing: the vocabulary needs no second decision", async () => {
    const inAdmissions = (title: string, tags: string[]): ChangesetIntent => ({
      ...(note(title, { themes: ["enrollment"], systems: [], tags }) as Extract<
        ChangesetIntent,
        { type: "create" }
      >),
      namespace: "admissions",
    });
    const { cs } = await h.submit({
      by: "alice",
      intents: [proposal("open-days"), inAdmissions("Run an open day", ["open-days"])],
    });
    expect(cs.reviewReasons.map((r) => r.code).sort()).toEqual(["new-term", "no-write-access"]);
    const { cs: after, outcome } = await decideAndRun(
      cs.id,
      decideTerm(
        cs.intents,
        { kind: "tag", slug: "open-days" },
        { decision: "accept", by: "human:dana" },
      ),
    );
    expect(after.reviewReasons).toEqual([]);
    expect(outcome.state).toBe("committed");
    expect(await h.read(".kb/tags.yaml")).toContain("open-days:");

    // Without a decision, the same writer cannot add to the vocabulary.
    const direct = await h.submit({
      by: "alice",
      intents: [{ type: "add_alias", kind: "tag", slug: "refunds", alias: "reimbursements" }],
    });
    expect(direct.cs.state).toBe("in_review");
    expect(direct.cs.reviewReasons.map((r) => r.code)).toContain("no-write-access");
  });

  it("rejected: the note is published without the term", async () => {
    const { cs } = await h.submit({
      by: "bob",
      intents: [proposal("misc"), note("Refund in cash", { tags: ["misc", "refunds"] })],
    });
    const { outcome } = await decideAndRun(
      cs.id,
      decideTerm(cs.intents, { kind: "tag", slug: "misc" }, { decision: "reject" }),
    );
    expect(outcome.state).toBe("committed");
    expect(parseNote((await h.read("kb/finance/refund-in-cash.md"))!, "x.md").data.tags).toEqual([
      "refunds",
    ]);
    expect(await h.read(".kb/tags.yaml")).not.toContain("misc");
  });
});

describe("publishing mode", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness("publishing");
    await h.index();
  });
  afterAll(() => h?.close());

  const ai = { aiDrafted: true, source: "upload" as const, actor: "ingest/claude-sonnet-5" };
  const inIt = (title: string): ChangesetIntent => ({
    ...(note(title, { themes: ["onboarding"], systems: [], tags: ["laptops"] }) as Extract<
      ChangesetIntent,
      { type: "create" }
    >),
    namespace: "it-support",
  });

  it("auto: a clean AI changeset is published without review", async () => {
    const { cs, outcome } = await h.submit({
      by: "dana",
      ...ai,
      intents: [inIt("Label a laptop")],
    });
    expect(outcome.state).toBe("committed");
    expect(cs.reviewReasons).toEqual([]);
    const written = parseNote((await h.read("kb/it-support/label-a-laptop.md"))!, "x.md");
    // Published, and honest about it: nobody has verified it.
    expect(written.data.verified).toBeUndefined();
    expect(written.data.generated).toMatchObject({ by: "ingest/claude-sonnet-5" });
  });

  it("manual: the same changeset waits for review", async () => {
    const { cs } = await h.submit({ by: "dana", ...ai, intents: [note("Post a late fee")] });
    expect(cs.state).toBe("in_review");
    expect(cs.reviewReasons.map((r) => r.code)).toEqual(["ai-manual-namespace"]);
  });

  it("auto: a likely duplicate is still reviewed", async () => {
    const saved = await h.save({ by: "dana", ...ai, intents: [inIt("Reset a password")] });
    await updateChangeset(h.db, saved.id, {
      duplicates: [
        {
          path: "kb/it-support/reset-a-password.md",
          otherId: "kb_existing",
          kind: "duplicate",
          score: 0.95,
        },
      ],
    });
    await processChangeset(h.changesets, saved.id);
    const cs = (await getChangeset(h.db, saved.id))!;
    expect(cs.state).toBe("in_review");
    expect(cs.reviewReasons.map((r) => r.code)).toEqual(["likely-duplicate"]);
  });

  it("auto: a proposed term and a process change to a verified note are still reviewed", async () => {
    const term = await h.submit({
      by: "dana",
      ...ai,
      intents: [
        { type: "add_term", kind: "tag", slug: "asset-tags", description: "Labels on devices." },
        inIt("Order asset tags"),
      ],
    });
    expect(term.cs.state).toBe("in_review");
    expect(term.cs.reviewReasons.map((r) => r.code)).toEqual(["new-term"]);

    const path = "kb/it-support/reset-a-staff-password.md";
    const edit = await h.submit({
      by: "dana",
      ...ai,
      changeClass: "process",
      summary: "Resets now need a ticket.",
      edit: { [path]: (t) => `${t}\nResets now need a ticket.\n` },
    });
    expect(edit.cs.state).toBe("in_review");
    expect(edit.cs.reviewReasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(["ai-process-change"]),
    );
  });
});
