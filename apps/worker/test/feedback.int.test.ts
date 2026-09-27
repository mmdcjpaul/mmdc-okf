import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newRecordId } from "@lore/changesets";
import {
  dismissReport,
  feedbackFor,
  FeedbackLimitError,
  getNote,
  recordFeedback,
  REPORTS_PER_DAY,
} from "@lore/db";
import { indexNames } from "@lore/search";
import { refreshHealth } from "../src/indexer/refresh-stale.ts";
import { createHarness, NOW, servicesAvailable, type Harness } from "./harness.ts";

await servicesAvailable();

const REFUND = "kb/finance/refund-policy.md";
const SCOPE = (h: Harness) => ({ vaultId: h.vaultId, namespaces: ["admissions", "finance"] });

describe("feedback", () => {
  let h: Harness;
  let noteId: string;
  let before: number;
  const doc = async () => h.meili.index(indexNames(h.slug).notes).getDocument(noteId);
  const note = async () => (await getNote(h.db, SCOPE(h), noteId))!;
  const report = (userId: string, reason: "outdated" | "unclear", at = NOW) =>
    recordFeedback(h.db, {
      id: newRecordId("fb", at),
      vaultId: h.vaultId,
      noteId,
      userId,
      kind: "report",
      reason,
      comment: "The refund window changed in August.",
      now: at,
    });

  beforeAll(async () => {
    h = await createHarness("feedback");
    await h.index();
    const [row] = await h.db.$client`
      select id, health_score from notes where vault_id = ${h.vaultId} and path = ${REFUND}`;
    noteId = row!.id;
    before = row!.health_score;
  });
  afterAll(() => h?.close());

  it("an outdated report lowers health by 25 and marks the note reported in search", async () => {
    expect((await doc()).reported).toBe(false);
    const fb = await report("carol", "outdated");
    expect(fb.state).toBe("open");
    await refreshHealth(h.deps, h.vaultId, [noteId]);
    expect((await note()).healthScore).toBe(before - 25);
    expect(await doc()).toMatchObject({ reported: true, health: before - 25 });
    const chunks = await h.meili
      .index(indexNames(h.slug).chunks)
      .getDocuments({ filter: `note_id = "${noteId}"`, fields: ["reported"], limit: 50 });
    expect(chunks.results.every((c) => c.reported === true)).toBe(true);
  });

  it("another kind of report costs 10 and does not mark it reported", async () => {
    await report("alice", "unclear");
    await refreshHealth(h.deps, h.vaultId, [noteId]);
    expect((await note()).healthScore).toBe(before - 35);
  });

  it("writers see open reports with who filed them", async () => {
    const f = await feedbackFor(h.db, h.vaultId, noteId, "bob");
    expect(f.open.map((r) => [r.reporterName, r.reason])).toEqual([
      ["Alice Reyes", "unclear"],
      ["Carol Diaz", "outdated"],
    ]);
  });

  it("a commit that resolves a report closes it once indexed, and health recovers", async () => {
    const open = (await feedbackFor(h.db, h.vaultId, noteId, "bob")).open;
    const outdated = open.find((r) => r.reason === "outdated")!;
    const { cs } = await h.submit({
      by: "bob",
      changeClass: "addition",
      edit: { [REFUND]: (s) => s + "\nRefunds are possible for 30 days from August.\n" },
    });
    expect(cs.state).toBe("committed");
    // Submitted without the trailer: nothing closes.
    await h.indexWithEffects();
    expect((await feedbackFor(h.db, h.vaultId, noteId, "bob")).open).toHaveLength(2);

    const { cs: fix } = await h.submit({
      by: "bob",
      edit: { [REFUND]: (s) => s + "\nSee the August notice.\n" },
      resolves: [outdated.id],
    });
    expect(fix.state).toBe("committed");
    // Committed but not indexed yet: still open.
    expect((await feedbackFor(h.db, h.vaultId, noteId, "bob")).open).toHaveLength(2);
    await h.indexWithEffects();

    const after = await feedbackFor(h.db, h.vaultId, noteId, "bob");
    expect(after.open.map((r) => r.reason)).toEqual(["unclear"]);
    const [closed] = await h.db.$client`
      select state, resolution from feedback where id = ${outdated.id}`;
    expect(closed).toMatchObject({ state: "resolved", resolution: fix.commitSha });
    expect((await doc()).reported).toBe(false);
    expect((await note()).healthScore).toBe(before - 10);
  });

  it("an owner can dismiss a report with a reason", async () => {
    const [open] = (await feedbackFor(h.db, h.vaultId, noteId, "bob")).open;
    const done = await dismissReport(h.db, open!.id, "bob", "It is clear enough.");
    expect(done).toMatchObject({ state: "dismissed", resolution: "It is clear enough." });
    expect(await dismissReport(h.db, open!.id, "bob", "Again")).toBeNull();
    await refreshHealth(h.deps, h.vaultId, [noteId]);
    expect((await note()).healthScore).toBe(before);
  });

  it("Helpful counts once per person and can be taken back", async () => {
    const helpful = (userId: string) =>
      recordFeedback(h.db, {
        id: newRecordId("fb"),
        vaultId: h.vaultId,
        noteId,
        userId,
        kind: "helpful",
        now: NOW,
      });
    const first = await helpful("carol");
    const again = await helpful("carol");
    expect(again.id).toBe(first.id);
    await helpful("alice");
    expect(await feedbackFor(h.db, h.vaultId, noteId, "carol")).toMatchObject({
      helpful: 2,
      mine: true,
    });
    expect((await feedbackFor(h.db, h.vaultId, noteId, "bob")).mine).toBe(false);
  });

  it(`refuses the ${REPORTS_PER_DAY + 1}th report in a day`, async () => {
    const day = new Date("2026-10-05T09:00:00Z");
    for (let i = 0; i < REPORTS_PER_DAY; i++)
      await report("erin", "unclear", new Date(day.getTime() + i * 60_000));
    await expect(report("erin", "unclear", new Date(day.getTime() + 3600_000))).rejects.toThrow(
      FeedbackLimitError,
    );
    // Other people are not affected, and tomorrow is another day.
    await expect(report("dana", "unclear", day)).resolves.toBeDefined();
    await expect(
      report("erin", "unclear", new Date(day.getTime() + 25 * 3600_000)),
    ).resolves.toBeDefined();
  });

  it("a rebuild from scratch ends with the same health, because feedback is not in the vault", async () => {
    await refreshHealth(h.deps, h.vaultId, [noteId]);
    const expected = (await note()).healthScore;
    await h.rebuild();
    expect((await note()).healthScore).toBe(expected);
    expect((await doc()).health).toBe(expected);
  });
});
