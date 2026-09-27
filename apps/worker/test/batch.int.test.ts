import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AiSettings,
  FakeBatchClient,
  FakeModelProvider,
  loadScripts,
  ModelGateway,
  scriptedProvider,
  type BatchClient,
} from "@lore/ai";
import { newRecordId } from "@lore/changesets";
import {
  createIngestItem,
  getIngestItem,
  pendingBatchRequests,
  questionsFor,
  setSetting,
} from "@lore/db";
import { inspect } from "@lore/ingest";
import { indexNames, searchNotes } from "@lore/search";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { usageStore } from "../src/ai.ts";
import { collectQuestions, queueQuestions, type Doc2QueryDeps } from "../src/batch/doc2query.ts";
import {
  inWorkingHours,
  pollBatches,
  submitBatches,
  type BatchDeps,
} from "../src/batch/schedule.ts";
import { batchTick } from "../src/batch/tick.ts";
import { processIngestItem, type IngestDeps } from "../src/ingest/process.ts";
import { mirrorFor } from "../src/runtime.ts";
import { createHarness, REPO, servicesAvailable, type Harness } from "./harness.ts";

await servicesAvailable();
const SCRIPTS = join(REPO, "packages/ai/test/scripts");
// A Thursday, ten in the morning.
const MORNING = new Date("2026-09-24T10:00:00Z");
const hours = (n: number) => new Date(MORNING.getTime() + n * 3_600_000);

describe("working hours", () => {
  it("are Monday to Friday, eight to six, in the organization's time zone", () => {
    expect(inWorkingHours(MORNING, "UTC")).toBe(true);
    expect(inWorkingHours(new Date("2026-09-24T07:59:00Z"), "UTC")).toBe(false);
    expect(inWorkingHours(new Date("2026-09-24T18:00:00Z"), "UTC")).toBe(false);
    expect(inWorkingHours(new Date("2026-09-26T10:00:00Z"), "UTC")).toBe(false);
    // Ten in the morning in UTC is six in the evening in Manila.
    expect(inWorkingHours(MORNING, "Asia/Manila")).toBe(false);
    expect(inWorkingHours(new Date("2026-09-24T01:00:00Z"), "Asia/Manila")).toBe(true);
  });
});

describe("batched processing", () => {
  let h: Harness;
  let fake: FakeModelProvider;
  let client: FakeBatchClient;
  let clients: Map<string, BatchClient>;
  let answered: [string, string][];
  let now: Date;

  const settings = async () =>
    AiSettings.parse(
      (await h.db.$client`select value from settings where key = 'ai'`)[0]?.value ?? {},
    );
  const gateway = () =>
    new ModelGateway({
      mode: "fake",
      provider: fake,
      settings,
      usage: usageStore(h.db),
      now: () => now,
    });
  const ingest = (): IngestDeps => ({
    db: h.db,
    meili: h.meili,
    objects: h.deps.objects,
    gateway: gateway(),
    embedder: h.deps.embedder,
    log: h.deps.log,
    mirrorFor,
    batch: { settings, providers: () => new Set(clients.keys()) },
    now: () => now,
  });
  const batch = (): BatchDeps => ({
    db: h.db,
    log: h.deps.log,
    clients: () => clients,
    gateway: gateway(),
    settings,
    usage: usageStore(h.db),
    onAnswered: async (kind, id) => void answered.push([kind, id]),
    timeZone: "UTC",
    now: () => now,
  });
  async function upload(name: string, by: string, namespace: string) {
    const bytes = new Uint8Array(readFileSync(join(REPO, "fixtures/uploads", name)));
    const { type } = await inspect(name, bytes);
    const id = newRecordId("in");
    await h.deps.objects.put(`uploads/${id}/${name}`, bytes);
    return createIngestItem(h.db, {
      id,
      vaultId: h.vaultId,
      submitterId: by,
      kind: "upload",
      namespace,
      hints: {},
      fileKey: `uploads/${id}/${name}`,
      fileName: name,
      fileType: type,
      fileSize: bytes.length,
      fileHash: id.padEnd(64, "0"),
    });
  }

  beforeAll(async () => {
    h = await createHarness("batch");
    await h.index();
  });
  afterAll(() => h?.close());
  beforeEach(async () => {
    fake = scriptedProvider(loadScripts(SCRIPTS));
    client = new FakeBatchClient("anthropic", fake);
    clients = new Map([["anthropic", client]]);
    answered = [];
    now = MORNING;
    await h.db.$client`delete from llm_batch_requests`;
    await h.db.$client`delete from llm_batches`;
    await h.db.$client`delete from llm_usage`;
    await h.db.$client`delete from settings where key in ('ai', 'batch_window')`;
  });

  it("an upload waits for the batch, and becomes a changeset when it has answered", async () => {
    const item = await upload("deposit-refund-sop.docx", "alice", "finance");
    expect(await processIngestItem(ingest(), item.id, { mode: "batch" })).toEqual({
      state: "batched",
      key: `ingest:${item.id}:ingest.atomize:1`,
    });
    expect((await getIngestItem(h.db, item.id))!.state).toBe("batched");
    expect(fake.calls).toEqual([]);

    const sent = await submitBatches(batch());
    expect(sent).toEqual([{ provider: "anthropic", batchId: expect.any(String), requests: 1 }]);
    expect(await pendingBatchRequests(h.db)).toEqual([]);
    // The request carries the same prompt a live call would.
    const [request] = [...client.batches.values()][0]!.items;
    expect(request!.model).toBe("claude-sonnet-5");
    expect(request!.request.instructions).toMatch(/^You turn a source document into notes/);
    expect(request!.request.context.join("\n")).toContain("# Vocabulary");
    expect(request!.request.input).toContain('<document label="deposit-refund-sop.docx">');

    now = hours(0.2);
    expect(await pollBatches(batch())).toEqual([
      { batchId: sent[0]!.batchId, state: "running", answered: 0, failed: 0 },
    ]);
    expect(answered).toEqual([]);

    client.finish();
    now = hours(0.5);
    expect(await pollBatches(batch())).toEqual([
      { batchId: sent[0]!.batchId, state: "ended", answered: 1, failed: 0 },
    ]);
    expect(answered).toEqual([["ingest", item.id]]);

    const calls = fake.calls.length;
    const outcome = await processIngestItem(ingest(), item.id, { mode: "batch" });
    expect(outcome.state).toBe("done");
    // The answer came from the batch: the model was not asked again.
    expect(fake.calls.length).toBe(calls);
    expect(await h.db.$client`select key from llm_batch_requests`).toEqual([]);

    const usage = await h.db.$client`
      select task, provider, model, batch, ok, user_id, namespace from llm_usage`;
    expect(usage).toEqual([
      {
        task: "ingest.atomize",
        provider: "anthropic",
        model: "claude-sonnet-5",
        batch: true,
        ok: true,
        user_id: "alice",
        namespace: "finance",
      },
    ]);
  });

  it("charges half for what a batch answered", async () => {
    fake = new FakeModelProvider().otherwise(() => ({
      output: { summary: "Nothing new.", items: [], proposedTerms: [] },
      usage: { input: 100_000, output: 10_000, cacheRead: 0, cacheWrite: 0 },
    }));
    client = new FakeBatchClient("anthropic", fake, { immediate: true });
    clients = new Map([["anthropic", client]]);
    const item = await upload("month-end-notes.md", "alice", "finance");
    await processIngestItem(ingest(), item.id, { mode: "batch" });
    await submitBatches(batch());
    await pollBatches(batch());
    const [row] = await h.db.$client`select cost_usd, input_tokens from llm_usage`;
    // 100,000 input at $2 and 10,000 output at $10 per million is $0.30; a batch is half.
    expect(row).toEqual({ cost_usd: 0.15, input_tokens: 100_000 });
  });

  it("Process now does not wait for a batch that is out", async () => {
    const item = await upload("deposit-refund-sop.docx", "alice", "finance");
    await processIngestItem(ingest(), item.id, { mode: "batch" });
    await submitBatches(batch());
    const outcome = await processIngestItem(ingest(), item.id, { mode: "now" });
    expect(outcome.state).toBe("done");
    expect(fake.calls).toHaveLength(1);
    const [row] = await h.db.$client`select batch from llm_usage`;
    expect(row).toEqual({ batch: false });
    // The batch's answer, when it comes, is for nobody.
    client.finish();
    await pollBatches(batch());
    expect(answered).toEqual([]);
  });

  it("sends nothing outside working hours, or within two hours of the last batch", async () => {
    const first = await upload("deposit-refund-sop.docx", "alice", "finance");
    await processIngestItem(ingest(), first.id, { mode: "batch" });
    now = new Date("2026-09-26T10:00:00Z");
    expect(await submitBatches(batch())).toEqual([]);
    now = MORNING;
    expect(await submitBatches(batch())).toHaveLength(1);

    const second = await upload("month-end-notes.md", "alice", "finance");
    await processIngestItem(ingest(), second.id, { mode: "batch" });
    now = hours(1.9);
    expect(await submitBatches(batch())).toEqual([]);
    expect(await pendingBatchRequests(h.db)).toHaveLength(1);
    now = hours(2);
    expect(await submitBatches(batch())).toHaveLength(1);
    // Forced, as the operator's command does, the clock is not asked.
    const third = await upload("helpdesk-hours.txt", "dana", "it-support");
    await processIngestItem(ingest(), third.id, { mode: "batch" });
    expect(await submitBatches(batch(), { force: true })).toHaveLength(1);
  });

  it("waits for budget, and sends when there is budget again", async () => {
    await setSetting(h.db, "ai", { budgets: { orgMonthlyUsd: 1 } });
    await h.db.$client`
      insert into llm_usage (task, provider, model, cost_usd, at)
      values ('desk.answer.single', 'anthropic', 'claude-haiku-4-5', 1.5, ${now.toISOString()}::timestamptz)`;
    const item = await upload("deposit-refund-sop.docx", "alice", "finance");
    await processIngestItem(ingest(), item.id, { mode: "batch" });
    expect(await submitBatches(batch())).toEqual([]);
    expect(await pendingBatchRequests(h.db)).toHaveLength(1);
    await setSetting(h.db, "ai", { budgets: { orgMonthlyUsd: 100 } });
    expect(await submitBatches(batch())).toHaveLength(1);
  });

  it("a request the batch did not answer is asked at once, at the normal price", async () => {
    fake = new FakeModelProvider()
      .enqueue({ error: new Error("overloaded_error") })
      .otherwise(() => ({ output: { summary: "Nothing new.", items: [], proposedTerms: [] } }));
    client = new FakeBatchClient("anthropic", fake, { immediate: true });
    clients = new Map([["anthropic", client]]);
    const item = await upload("month-end-notes.md", "alice", "finance");
    await processIngestItem(ingest(), item.id, { mode: "batch" });
    await submitBatches(batch());
    expect(await pollBatches(batch())).toEqual([
      { batchId: expect.any(String), state: "ended", answered: 0, failed: 1 },
    ]);
    expect(answered).toEqual([["ingest", item.id]]);
    const outcome = await processIngestItem(ingest(), item.id, { mode: "batch" });
    expect(outcome.state).not.toBe("batched");
    const usage = await h.db.$client`select batch, ok from llm_usage order by id`;
    expect(usage).toEqual([
      { batch: true, ok: false },
      { batch: false, ok: true },
    ]);
  });

  it("a batch that is never answered is given up after a day", async () => {
    const item = await upload("deposit-refund-sop.docx", "alice", "finance");
    await processIngestItem(ingest(), item.id, { mode: "batch" });
    await submitBatches(batch());
    now = hours(25);
    expect((await pollBatches(batch()))[0]!.state).toBe("running");
    now = hours(27);
    expect(await pollBatches(batch())).toEqual([
      { batchId: expect.any(String), state: "failed", answered: 0, failed: 1 },
    ]);
    expect(answered).toEqual([["ingest", item.id]]);
    expect(await h.db.$client`select state, error from llm_batches`).toEqual([
      { state: "failed", error: "The provider did not answer within a day" },
    ]);
  });

  it("with OpenRouter only, nothing waits: there is no batch API to wait for", async () => {
    await setSetting(h.db, "ai", {
      tasks: { "ingest.atomize": { primary: "openrouter:anthropic/claude-sonnet-5", batch: true } },
    });
    clients = new Map();
    const item = await upload("deposit-refund-sop.docx", "alice", "finance");
    const outcome = await processIngestItem(ingest(), item.id, { mode: "batch" });
    expect(outcome.state).toBe("done");
    expect(fake.calls[0]).toMatchObject({ provider: "openrouter" });
    expect(await pendingBatchRequests(h.db)).toEqual([]);
  });

  it("a turn of the schedule starts what is queued, then sends, then collects", async () => {
    client = new FakeBatchClient("anthropic", fake, { immediate: true });
    clients = new Map([["anthropic", client]]);
    const item = await upload("deposit-refund-sop.docx", "alice", "finance");
    const started: string[] = [];
    const deps = {
      ...batch(),
      startItem: async (id: string) => {
        started.push(id);
        await processIngestItem(ingest(), id, { mode: "batch" });
      },
      onAnswered: async (_kind: string, id: string) => {
        await processIngestItem(ingest(), id, { mode: "batch" });
      },
    };
    // The Sunday before: nothing is started or sent.
    now = new Date("2026-09-20T10:00:00Z");
    expect(await batchTick(deps)).toEqual({ started: 0, submitted: [], polled: [] });
    now = MORNING;
    const tick = await batchTick(deps);
    expect(started).toEqual([item.id]);
    expect(tick.started).toBe(1);
    expect(tick.submitted).toHaveLength(1);
    expect(tick.polled).toEqual([
      { batchId: tick.submitted[0]!.batchId, state: "ended", answered: 1, failed: 0 },
    ]);
    expect((await getIngestItem(h.db, item.id))!.state).toBe("done");
    // The window opens again in two hours, not before.
    const late = await upload("month-end-notes.md", "alice", "finance");
    now = hours(1);
    expect((await batchTick(deps)).started).toBe(0);
    now = hours(2);
    expect((await batchTick(deps)).started).toBe(1);
    expect(started).toEqual([item.id, late.id]);
  });
});

describe("example questions (doc2query)", () => {
  let h: Harness;
  let fake: FakeModelProvider;
  let client: FakeBatchClient;
  const REFUND = "kb/finance/issue-a-student-refund.md";
  const QUESTIONS = [
    "How do I get my tuition money back?",
    "Who signs off on reimbursing a learner?",
    "How long until the bank transfer arrives?",
  ];
  const settings = () => AiSettings.parse({});
  const deps = (): Doc2QueryDeps => ({
    db: h.db,
    meili: h.meili,
    embedder: h.deps.embedder,
    gateway: new ModelGateway({
      mode: "fake",
      provider: fake,
      settings,
      usage: usageStore(h.db),
    }),
    settings,
    log: h.deps.log,
    now: () => MORNING,
  });
  const batch = (): BatchDeps => ({
    db: h.db,
    log: h.deps.log,
    clients: () => new Map<string, BatchClient>([["anthropic", client]]),
    gateway: deps().gateway,
    settings,
    usage: usageStore(h.db),
    onAnswered: async (kind, id) => {
      if (kind === "doc2query") await collectQuestions(deps(), id);
    },
    timeZone: "UTC",
    now: () => MORNING,
  });
  const idOf = async (path: string) =>
    (await h.db.$client`select id from notes where vault_id = ${h.vaultId} and path = ${path}`)[0]!
      .id as string;
  const find = async (q: string) =>
    (
      await searchNotes(h.meili, {
        vaultSlug: h.slug,
        scope: { vaultId: h.vaultId, namespaces: ["finance", "admissions", "it-support"] },
        q,
        vector: null,
        limit: 5,
      })
    ).hits.map((n) => n.title);

  beforeAll(async () => {
    h = await createHarness("doc2query");
    await h.index();
  });
  afterAll(() => h?.close());
  beforeEach(() => {
    fake = new FakeModelProvider().otherwise((call) =>
      call.instructions.startsWith("You write the questions")
        ? {
            output: {
              questions: call.input.includes("Issue a student refund")
                ? QUESTIONS
                : ["What does this note cover, in one line?"],
            },
          }
        : undefined,
    );
    client = new FakeBatchClient("anthropic", fake, { immediate: true });
  });

  it("asks for the notes that can have questions, and only those", async () => {
    const all = (await h.db.$client`select id from notes where vault_id = ${h.vaultId}`).map(
      (r) => r.id as string,
    );
    const queued = await queueQuestions(deps(), h.vaultId, all);
    const rows = await h.db.$client`
      select r.owner_id, r.task, r.model, n.namespace, n.type, n.status, n.hub_kind
      from llm_batch_requests r
      join notes n on n.vault_id || ':' || n.id = r.owner_id`;
    expect(rows).toHaveLength(queued);
    expect(queued).toBeGreaterThan(20);
    // People Ops does not allow AI processing; hubs, drafts, and deprecated notes are skipped.
    expect(rows.filter((r) => r.namespace === "people-ops")).toEqual([]);
    expect(rows.filter((r) => r.hub_kind !== null || r.status !== "stable")).toEqual([]);
    expect(new Set(rows.map((r) => r.model))).toEqual(new Set(["claude-haiku-4-5"]));
    // Asking twice stores nothing twice.
    expect(await queueQuestions(deps(), h.vaultId, all)).toBe(queued);
    expect(await h.db.$client`select count(*)::int as n from llm_batch_requests`).toEqual([
      { n: queued },
    ]);
  });

  it("the note is then found by a question in words it does not use", async () => {
    expect(await find("get my tuition money back")).not.toContain("Issue a student refund");
    await submitBatches(batch(), { force: true });
    await pollBatches(batch());

    const id = await idOf(REFUND);
    const stored = (await questionsFor(h.db, h.vaultId, [id])).get(id)!;
    expect(stored.questions).toEqual(QUESTIONS);
    expect(stored.model).toBe("anthropic:claude-haiku-4-5");
    const doc = (
      await h.meili
        .index(indexNames(h.slug).notes)
        .getDocuments({ ids: [id], retrieveVectors: true, limit: 1 })
    ).results[0]!;
    expect(doc.questions).toEqual(QUESTIONS);
    expect((doc._vectors as { default: { embeddings: unknown[] } }).default).toBeTruthy();
    expect((await find("get my tuition money back"))[0]).toBe("Issue a student refund");
    expect(await h.db.$client`select key from llm_batch_requests`).toEqual([]);
    // Nothing is asked again while the note stays the same.
    expect(await queueQuestions(deps(), h.vaultId, [id])).toBe(0);
  });

  it("the questions survive an edit until new ones arrive, and a full reindex", async () => {
    const id = await idOf(REFUND);
    await h.submit({
      by: "bob",
      edit: { [REFUND]: (t) => `${t}\nRefunds over $500 need a second approver.\n` },
    });
    await h.index();
    expect((await find("get my tuition money back"))[0]).toBe("Issue a student refund");
    // The note changed, so new questions are asked for.
    expect(await queueQuestions(deps(), h.vaultId, [id])).toBe(1);

    await h.rebuild();
    expect((await find("get my tuition money back"))[0]).toBe("Issue a student refund");
    const doc = await h.meili.index(indexNames(h.slug).notes).getDocument(id);
    expect(doc.questions).toEqual(QUESTIONS);
  });

  it("asks nothing when AI is off", async () => {
    const off = {
      ...deps(),
      gateway: new ModelGateway({
        mode: "off",
        provider: fake,
        settings,
        usage: usageStore(h.db),
      }),
    };
    await h.db.$client`delete from llm_batch_requests`;
    await h.db.$client`delete from note_questions`;
    expect(await queueQuestions(off, h.vaultId, [await idOf(REFUND)])).toBe(0);
  });
});
