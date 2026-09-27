import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getChangeset, listChangesets, listGardenerRuns, setSetting } from "@lore/db";
import { GitTreeSource } from "@lore/git";
import { lint, loadVault, parseNote } from "@lore/okf";
import { processChangeset } from "../src/changesets/process.ts";
import type { GardenerReport } from "../src/gardener/report.ts";
import { runGardener, type GardenerDeps } from "../src/gardener/run.ts";
import { mirrorFor } from "../src/runtime.ts";
import { createHarness, NOW, servicesAvailable, type Harness } from "./harness.ts";

await servicesAvailable();

const head = (h: Harness) =>
  execFileSync("git", ["--git-dir", h.bare, "rev-parse", "main"], { encoding: "utf8" }).trim();
const report = (run: { report: unknown }) => run.report as GardenerReport;
const titles = (list: { title: string }[]) => list.map((n) => n.title);

describe("the Gardener", () => {
  let h: Harness;
  let deps: GardenerDeps;
  const queued: string[] = [];
  beforeAll(async () => {
    h = await createHarness("gardener");
    await h.index();
    deps = {
      db: h.db,
      meili: h.meili,
      log: h.deps.log,
      mirrorFor,
      now: () => h.clock.now,
      onChangeset: async (id) => void queued.push(id),
    };
  });
  afterAll(() => h?.close());

  it("finds the near-duplicate pair, the orphan, and the wanted note", async () => {
    const before = head(h);
    const run = await runGardener(deps, { vaultId: h.vaultId });
    expect(run).toMatchObject({ state: "done", error: null, namespace: null, requestedBy: null });
    const r = report(run);
    expect(r.notes).toBe(45);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]!.keep.title).toBe("Clean up duplicate contacts");
    expect(titles(r.duplicates[0]!.others)).toEqual(["Merge duplicate student records"]);
    expect(titles(r.orphans)).toEqual(["Set up a campus printer"]);
    expect(r.wanted).toEqual([
      expect.objectContaining({
        path: "/it-support/unlock-a-locked-account.md",
        namespace: "it-support",
      }),
    ]);
    expect(titles(r.wanted[0]!.wantedBy)).toEqual(["Reset a staff password"]);
    expect(titles(r.stale)).toEqual(["Approve vendor invoices"]);
    expect(titles(r.unverified)).toEqual(["How deposits flow from Salesforce to NetSuite"]);
    expect(r.drift.tagsUsedOnce.map((t) => t.slug)).toEqual([
      "leave",
      "returning-students",
      "security",
    ]);
    expect(r.skipped).toEqual([]);

    // Three proposals, handed to the pipeline, and nothing committed.
    expect(run.proposals).toHaveLength(3);
    expect(queued).toEqual(run.proposals);
    expect(head(h)).toBe(before);
  });

  it("every proposal waits for a person, even in a namespace that publishes by itself", async () => {
    const before = head(h);
    const [run] = await listGardenerRuns(h.db, h.vaultId);
    const states = [];
    for (const id of run!.proposals) {
      await processChangeset(h.changesets, id);
      const cs = (await getChangeset(h.db, id))!;
      states.push({
        title: cs.title,
        state: cs.state,
        namespaces: cs.namespaces,
        codes: cs.reviewReasons.map((r) => r.code),
        actor: cs.actor,
        by: cs.submitterId,
      });
    }
    const common = { state: "in_review", actor: "process:gardener", by: null };
    expect(states).toEqual([
      {
        ...common,
        title: 'deprecate "Merge duplicate student records"',
        namespaces: ["admissions"],
        codes: ["gardener-proposal", "destructive"],
      },
      // IT Support publishes AI drafts without review. The Gardener's proposals still wait.
      {
        ...common,
        title: 'update "Set up a new hire laptop"',
        namespaces: ["it-support"],
        codes: ["gardener-proposal"],
      },
      {
        ...common,
        title: 'add "Unlock a locked account"',
        namespaces: ["it-support"],
        codes: ["gardener-proposal"],
      },
    ]);
    expect(head(h)).toBe(before);
  });

  it("says why, so the reviewer can decide", async () => {
    const all = await listChangesets(h.db, { vaultId: h.vaultId, states: ["in_review"] });
    const why = Object.fromEntries(all.map((c) => [c.title, c.reason]));
    expect(why['deprecate "Merge duplicate student records"']).toMatch(
      /look like the same note: 76% similar, with 54% of the words/,
    );
    expect(why['update "Set up a new hire laptop"']).toMatch(
      /^Nothing links to "Set up a campus printer"/,
    );
    expect(why['add "Unlock a locked account"']).toMatch(/^"Reset a staff password" links to/);
  });

  it("does not propose the same thing twice", async () => {
    const again = await runGardener(deps, { vaultId: h.vaultId, requestedBy: "dana" });
    expect(again.state).toBe("done");
    expect(again.requestedBy).toBe("dana");
    expect(again.proposals).toEqual([]);
    expect(report(again).duplicates).toHaveLength(1);
    expect(
      await listChangesets(h.db, { vaultId: h.vaultId, states: ["in_review", "submitted"] }),
    ).toHaveLength(3);
  });

  it("an approved proposal is committed like any change, crediting the reviewer", async () => {
    const all = await listChangesets(h.db, { vaultId: h.vaultId, states: ["in_review"] });
    const dup = all.find((c) => c.title.startsWith("deprecate"))!;
    const { outcome } = await h.approve(dup.id, "dana");
    expect(outcome.state).toBe("committed");
    const text = (await h.read("kb/admissions/merge-duplicate-student-records.md"))!;
    const note = parseNote(text, "kb/admissions/merge-duplicate-student-records.md");
    expect(note.data).toMatchObject({
      status: "deprecated",
      superseded_by: "/admissions/clean-up-duplicate-contacts.md",
    });
    const message = execFileSync("git", ["--git-dir", h.bare, "log", "-1", "--format=%an%n%B"], {
      encoding: "utf8",
    });
    expect(message).toContain('deprecate "Merge duplicate student records"');
    expect(message).toMatch(/Source: gardener/);
    expect(message).toMatch(/Co-authored-by: Dana Ito/);

    const wanted = all.find((c) => c.title.startsWith("add"))!;
    expect((await h.approve(wanted.id, "dana")).outcome.state).toBe("committed");
    const draft = parseNote(
      (await h.read("kb/it-support/unlock-a-locked-account.md"))!,
      "kb/it-support/unlock-a-locked-account.md",
    );
    expect(draft.data).toMatchObject({ status: "draft", title: "Unlock a locked account" });

    const mirror = mirrorFor(`local:${h.bare}`);
    const at = (await mirror.resolve("refs/heads/main"))!;
    const vault = await loadVault(await new GitTreeSource(mirror, at).load(["kb/", ".kb/"]));
    const issues = (await lint(vault, { now: NOW })).issues.filter((i) => i.severity === "error");
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });

  it("after indexing, what was fixed is no longer found", async () => {
    await h.index();
    const run = await runGardener(deps, { vaultId: h.vaultId });
    const r = report(run);
    expect(r.duplicates).toEqual([]);
    expect(r.wanted).toEqual([]);
    // The orphan's proposal is still waiting, so it is still an orphan, and not proposed again.
    expect(titles(r.orphans)).toEqual(["Set up a campus printer"]);
    expect(run.proposals).toEqual([]);
  });

  it("refuses to run on a vault that is behind its repository", async () => {
    const { outcome } = await h.submit({
      by: "alice",
      edit: { "kb/admissions/check-an-applications-status.md": (t) => `${t}\nOne more line.\n` },
    });
    expect(outcome.state).toBe("committed");
    const run = await runGardener(deps, { vaultId: h.vaultId });
    expect(run.state).toBe("failed");
    expect(run.error).toMatch(/being indexed/);
    await h.index();
  });
});

describe("the Gardener, for one namespace", () => {
  let h: Harness;
  let deps: GardenerDeps;
  beforeAll(async () => {
    h = await createHarness("gardener-ns");
    await h.index();
    deps = { db: h.db, meili: h.meili, log: h.deps.log, mirrorFor, now: () => h.clock.now };
  });
  afterAll(() => h?.close());

  it("looks at that namespace only, and leaves the vocabulary to whole-vault runs", async () => {
    const run = await runGardener(deps, { vaultId: h.vaultId, namespace: "admissions" });
    const r = report(run);
    expect(run.namespace).toBe("admissions");
    expect(r.duplicates).toHaveLength(1);
    expect(r.orphans).toEqual([]);
    expect(r.wanted).toEqual([]);
    expect(r.stale).toEqual([]);
    expect(r.drift.tagsUsedOnce).toEqual([]);
    expect(run.proposals).toHaveLength(1);
  });

  it("fails for a namespace that does not exist", async () => {
    await expect(runGardener(deps, { vaultId: h.vaultId, namespace: "nope" })).rejects.toThrow(
      /Unknown namespace/,
    );
  });

  it("uses the thresholds in settings, and stops at its share of proposals", async () => {
    await setSetting(h.db, "gardener", { wordsInCommon: 0.9, maxProposals: 1 });
    const strict = await runGardener(deps, { vaultId: h.vaultId });
    expect(report(strict).duplicates).toEqual([]);
    expect(strict.proposals).toHaveLength(1);
    expect(report(strict).skipped).toEqual([
      { what: expect.stringMatching(/^wanted:/), why: "This run had made its share of proposals" },
    ]);
  });

  it("reports knowledge gaps from the source it is given", async () => {
    const run = await runGardener(
      {
        ...deps,
        gaps: {
          async gaps(q) {
            expect(q.namespaces).toEqual(["finance"]);
            return [
              {
                question: "Can a deposit be refunded in cash?",
                count: 5,
                namespace: "finance",
                lastAskedAt: NOW,
              },
            ];
          },
        },
      },
      { vaultId: h.vaultId, namespace: "finance" },
    );
    expect(report(run).gaps).toHaveLength(1);
  });
});
