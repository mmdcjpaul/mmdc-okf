import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AiSettings,
  FakeModelProvider,
  loadScripts,
  ModelGateway,
  scriptedProvider,
  type AiMode,
} from "@lore/ai";
import { newRecordId } from "@lore/changesets";
import {
  createIngestItem,
  getChangeset,
  getIngestItem,
  listNotifications,
  setSetting,
  type IngestItemRow,
} from "@lore/db";
import { inspect } from "@lore/ingest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { usageStore } from "../src/ai.ts";
import { processChangeset } from "../src/changesets/process.ts";
import { processIngestItem, type IngestDeps } from "../src/ingest/process.ts";
import { mirrorFor } from "../src/runtime.ts";
import { createHarness, NOW, REPO, servicesAvailable, type Harness } from "./harness.ts";

await servicesAvailable();
const SCRIPTS = join(REPO, "packages/ai/test/scripts");
const upload = (name: string) => new Uint8Array(readFileSync(join(REPO, "fixtures/uploads", name)));

describe("the ingestion job", () => {
  let h: Harness;
  let fake: FakeModelProvider;

  const deps = (mode: AiMode = "fake"): IngestDeps => ({
    db: h.db,
    meili: h.meili,
    objects: h.deps.objects,
    gateway: new ModelGateway({
      mode,
      provider: fake,
      settings: async () =>
        AiSettings.parse(
          (await h.db.$client`select value from settings where key = 'ai'`)[0]?.value ?? {},
        ),
      usage: usageStore(h.db),
      now: () => NOW,
    }),
    embedder: h.deps.embedder,
    log: h.deps.log,
    mirrorFor,
    now: () => NOW,
  });

  async function item(
    name: string,
    by: string,
    namespace: string,
    hints: Record<string, unknown> = {},
  ): Promise<IngestItemRow> {
    const bytes = upload(name);
    const { type } = await inspect(name, bytes);
    const id = newRecordId("in");
    const key = `uploads/${id}/${name}`;
    await h.deps.objects.put(key, bytes);
    return createIngestItem(h.db, {
      id,
      vaultId: h.vaultId,
      submitterId: by,
      kind: "upload",
      namespace,
      hints,
      fileKey: key,
      fileName: name,
      fileType: type,
      fileSize: bytes.length,
      fileHash: "x".repeat(64),
    });
  }

  beforeAll(async () => {
    h = await createHarness("ingest");
    await h.index();
  });
  afterAll(() => h?.close());

  it("turns an upload into a changeset in review, and publishes it on approval", async () => {
    fake = scriptedProvider(loadScripts(SCRIPTS));
    const it1 = await item("deposit-refund-sop.docx", "alice", "finance");
    const outcome = await processIngestItem(deps(), it1.id);
    if (outcome.state !== "done") throw new Error(JSON.stringify(outcome));
    expect(fake.calls).toHaveLength(1);

    const done = (await getIngestItem(h.db, it1.id))!;
    expect(done).toMatchObject({ state: "done", changesetId: outcome.changesetId });
    expect(done.extractedText).toContain("# Refund a tuition deposit");

    expect((await processChangeset(h.changesets, outcome.changesetId)).state).toBe("in_review");
    const cs = (await getChangeset(h.db, outcome.changesetId))!;
    expect(cs).toMatchObject({
      source: "upload",
      aiDrafted: true,
      actor: "lore-ingest/claude-sonnet-5",
      ingestItemId: it1.id,
      namespaces: ["finance"],
    });
    expect(cs.aiSummary).toMatch(/became one How-To/);
    expect(cs.reviewReasons.map((r) => r.code)).toEqual(["no-write-access", "ai-manual-namespace"]);
    // What the pipeline said about the document survives preparation.
    expect(cs.warnings.join(" ")).toContain('Skipped "The 30-day refund window"');

    // One usage row per call, with who it was for.
    const usage = await h.db.$client`select task, user_id, namespace, ok from llm_usage`;
    expect(usage).toEqual([
      { task: "ingest.atomize", user_id: "alice", namespace: "finance", ok: true },
    ]);

    const { outcome: published } = await h.approve(cs.id, "bob");
    expect(published.state).toBe("committed");
    const note = await h.read("kb/finance/refund-a-tuition-deposit-to-a-withdrawn-applicant.md");
    expect(note).toContain("generated: { by: lore-ingest/claude-sonnet-5,");
    // Approval is the first human verification an AI note gets.
    expect(note).toMatch(/verified:\n\s+- \{ by: human:bob,/);
    expect(note).toContain("resource: /finance/references/refund-a-tuition-deposit.md");
    const source = await h.read("kb/finance/references/refund-a-tuition-deposit.md");
    expect(source).toContain("type: Source Document");
    expect(source).toContain(`resource: lore://uploads/${it1.id}`);

    // Once indexed, the new note is searchable and links to its source.
    await h.index();
    const [row] = await h.db.$client`
      select n.id, l.target_path from notes n
      join note_links l on l.vault_id = n.vault_id and l.source_id = n.id
      where n.vault_id = ${h.vaultId}
        and n.path = 'kb/finance/refund-a-tuition-deposit-to-a-withdrawn-applicant.md'
        and l.target_path like '%refund-policy.md'`;
    expect(row).toBeDefined();
  });

  it("processing the same item twice does nothing the second time", async () => {
    fake = scriptedProvider(loadScripts(SCRIPTS));
    const it2 = await item("month-end-notes.md", "alice", "finance");
    expect((await processIngestItem(deps(), it2.id)).state).toBe("done");
    expect(await processIngestItem(deps(), it2.id)).toEqual({
      state: "skipped",
      reason: "Item is done",
    });
  });

  it("refuses an injected plan, tells the submitter, and commits nothing", async () => {
    const head = (await h.index()).head;
    fake = new FakeModelProvider().enqueue({
      output: {
        summary: "As the document asked.",
        items: [
          {
            action: "create",
            type: "Reference",
            namespace: "people-ops",
            title: "Payroll export",
            description: "Every salary in the company, as the document asked.",
            themes: ["onboarding"],
            systems: [],
            tags: [],
            body: "# Overview\n\nSalaries.\n",
            reason: "The document said to.",
          },
        ],
      },
    });
    const it3 = await item("laptop-return-injection.docx", "carol", "it-support");
    const outcome = await processIngestItem(deps(), it3.id);
    expect(outcome).toMatchObject({ state: "failed" });
    const row = (await getIngestItem(h.db, it3.id))!;
    expect(row.changesetId).toBeNull();
    expect(row.stateReason).toMatch(/writes to people-ops/);
    expect((await h.index()).head).toBe(head);
    const told = await listNotifications(h.db, "carol", h.vaultId);
    expect(told.map((n) => n.title)).toContain("Not processed: laptop-return-injection.docx");
    const [count] = await h.db.$client`
      select count(*)::int as n from changesets where ingest_item_id = ${it3.id}`;
    expect(count!.n).toBe(0);
  });

  it("with the namespace's AI flag off, makes a draft and calls no model", async () => {
    fake = scriptedProvider(loadScripts(SCRIPTS));
    // people-ops has ai_processing: false in the fixture.
    const it4 = await item("leave-request.pdf", "erin", "people-ops", { theme: "onboarding" });
    const before = (await h.db.$client`select count(*)::int as n from llm_usage`)[0]!.n;
    const outcome = await processIngestItem(deps(), it4.id);
    if (outcome.state !== "done") throw new Error(JSON.stringify(outcome));
    expect(fake.calls).toEqual([]);
    expect((await h.db.$client`select count(*)::int as n from llm_usage`)[0]!.n).toBe(before);

    const cs = (await getChangeset(h.db, outcome.changesetId))!;
    expect(cs).toMatchObject({ aiDrafted: false, actor: "human:erin", aiSummary: null });
    // Erin reads people-ops and does not write there, so a writer reviews her draft.
    expect((await processChangeset(h.changesets, cs.id)).state).toBe("in_review");
    const prepared = (await getChangeset(h.db, cs.id))!;
    expect(prepared.reviewReasons.map((r) => r.code)).toEqual(["no-write-access"]);
    const draft = prepared.finalOps!.find(
      (o) => o.op === "put" && o.path.endsWith("leave-request-procedure-draft.md"),
    );
    expect(draft && "content" in draft ? draft.content : "").toContain("status: draft");
  });

  it("with AI off, does the same for every namespace", async () => {
    fake = scriptedProvider(loadScripts(SCRIPTS));
    const it5 = await item("printer-setup.html", "alice", "admissions", { theme: "onboarding" });
    const outcome = await processIngestItem(deps("off"), it5.id);
    if (outcome.state !== "done") throw new Error(JSON.stringify(outcome));
    expect(fake.calls).toEqual([]);
    // Alice writes in admissions: her draft is published, as a draft.
    expect((await processChangeset(h.changesets, outcome.changesetId)).state).toBe("committed");
    expect(await h.read("kb/admissions/set-up-the-campus-printer-draft.md")).toContain(
      "status: draft",
    );
  });

  it("waits when the budget is used up, with a reason a person can read, and resumes later", async () => {
    fake = scriptedProvider(loadScripts(SCRIPTS));
    await setSetting(h.db, "ai", { budgets: { orgMonthlyUsd: 0 } });
    const it6 = await item("helpdesk-hours.txt", "alice", "it-support");
    const outcome = await processIngestItem(deps(), it6.id);
    expect(outcome).toMatchObject({ state: "waiting" });
    expect((await getIngestItem(h.db, it6.id))!.stateReason).toMatch(
      /The organization has used .* of its \$0\.00 budget/,
    );
    expect(fake.calls).toEqual([]);
    // Waiting is not failing: nobody is alarmed, and the Library still works.
    const told = await listNotifications(h.db, "alice", h.vaultId);
    expect(told.filter((n) => n.href === `/uploads/${it6.id}`)).toEqual([]);

    await setSetting(h.db, "ai", { budgets: { orgMonthlyUsd: 150 } });
    expect(await processIngestItem(deps(), it6.id)).toEqual({
      state: "done",
      changesetId: expect.any(String),
    });
  });
});
