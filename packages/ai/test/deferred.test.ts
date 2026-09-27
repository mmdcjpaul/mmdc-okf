import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiSettings,
  customIdOf,
  DeferredError,
  DeferringGateway,
  FakeBatchClient,
  FakeModelProvider,
  InvalidOutputError,
  ModelGateway,
  type DeferredStore,
  type StoredAnswer,
  type UsageRecord,
} from "../src/index.ts";

const Plan = z.object({ summary: z.string(), items: z.array(z.string()).default([]) });

class MemoryStore implements DeferredStore {
  rows = new Map<string, StoredAnswer & { request?: unknown; task?: string }>();
  async get(key: string) {
    return this.rows.get(key) ?? null;
  }
  async put(row: Parameters<DeferredStore["put"]>[0]) {
    if (!this.rows.has(row.key))
      this.rows.set(row.key, {
        state: "pending",
        provider: row.provider,
        model: row.model,
        answer: null,
        usage: null,
        error: null,
        request: row.request,
        task: row.task,
      });
  }
  async drop(key: string) {
    this.rows.delete(key);
  }
  answer(key: string, value: unknown) {
    Object.assign(this.rows.get(key)!, {
      state: "done",
      answer: typeof value === "string" ? value : JSON.stringify(value),
      usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
    });
  }
}

let fake: FakeModelProvider;
let store: MemoryStore;
let usage: UsageRecord[];
const make = (over: { batch?: string[]; settings?: unknown } = {}) =>
  new DeferringGateway({
    inner: new ModelGateway({
      mode: "fake",
      provider: fake,
      settings: () => AiSettings.parse(over.settings ?? {}),
      usage: { record: async (r) => void usage.push(r), spentSince: async () => 0 },
    }),
    store,
    settings: () => AiSettings.parse(over.settings ?? {}),
    batchProviders: new Set(over.batch ?? ["anthropic"]),
    owner: "ingest:in_1",
  });
const ask = (g: DeferringGateway, task: "ingest.atomize" | "desk.classify" = "ingest.atomize") =>
  g.generate({ task, instructions: "Make a plan.", input: "The document.", schema: Plan });

beforeEach(() => {
  fake = new FakeModelProvider();
  store = new MemoryStore();
  usage = [];
});

describe("DeferringGateway", () => {
  it("stores a call that may wait, and stops the work there", async () => {
    await expect(ask(make())).rejects.toBeInstanceOf(DeferredError);
    expect(fake.calls).toEqual([]);
    const row = store.rows.get("ingest:in_1:ingest.atomize:1")!;
    expect(row).toMatchObject({
      state: "pending",
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(row.request).toMatchObject({
      instructions: "Make a plan.",
      input: "The document.",
      maxOutputTokens: 32_000,
      schema: { type: "object", properties: { summary: { type: "string" } } },
    });
  });

  it("keeps waiting while the batch is out, without storing the call twice", async () => {
    await expect(ask(make())).rejects.toBeInstanceOf(DeferredError);
    store.rows.get("ingest:in_1:ingest.atomize:1")!.state = "submitted";
    await expect(ask(make())).rejects.toBeInstanceOf(DeferredError);
    expect(store.rows.size).toBe(1);
  });

  it("returns the stored answer on the next run, at the batch price, and goes on to the next call", async () => {
    await expect(ask(make())).rejects.toBeInstanceOf(DeferredError);
    store.answer("ingest:in_1:ingest.atomize:1", { summary: "One note." });
    const again = make();
    const first = await ask(again);
    expect(first.output).toEqual({ summary: "One note.", items: [] });
    expect(first.model).toBe("anthropic:claude-sonnet-5");
    // 1000 input at $2 and 200 output at $10 per million, halved.
    expect(first.costUsd).toBeCloseTo(0.002);
    // The repair call is the second call of the task, and waits for the next batch.
    await expect(ask(again)).rejects.toMatchObject({ key: "ingest:in_1:ingest.atomize:2" });
    expect(fake.calls).toEqual([]);
  });

  it("calls the model at once for a task that is not batched", async () => {
    fake.enqueue({ output: { summary: "Now." } });
    const res = await ask(make(), "desk.classify");
    expect(res.output.summary).toBe("Now.");
    expect(store.rows.size).toBe(0);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.batch).toBe(false);
  });

  it("calls the model at once when the provider has no batch API", async () => {
    fake.enqueue({ output: { summary: "Through OpenRouter." } });
    const settings = {
      tasks: { "ingest.atomize": { primary: "openrouter:some/model", batch: true } },
    };
    const res = await ask(make({ settings }));
    expect(res.output.summary).toBe("Through OpenRouter.");
    expect(store.rows.size).toBe(0);
  });

  it("calls the model at once for images too large to store", async () => {
    fake.enqueue({ output: { summary: "A big scan." } });
    const res = await make().generate({
      task: "ingest.extract",
      instructions: "Read the file.",
      input: "Convert it.",
      images: [{ bytes: new Uint8Array(6 * 1024 * 1024), mediaType: "application/pdf" }],
      schema: Plan,
    });
    expect(res.output.summary).toBe("A big scan.");
    expect(store.rows.size).toBe(0);
  });

  it("asks at once, at the normal price, when the batch did not answer", async () => {
    await expect(ask(make())).rejects.toBeInstanceOf(DeferredError);
    Object.assign(store.rows.get("ingest:in_1:ingest.atomize:1")!, {
      state: "failed",
      error: "expired",
    });
    fake.enqueue({ output: { summary: "Asked directly." } });
    const res = await ask(make());
    expect(res.output.summary).toBe("Asked directly.");
    expect(store.rows.size).toBe(0);
  });

  it("refuses an answer that does not fit, and forgets it", async () => {
    await expect(ask(make())).rejects.toBeInstanceOf(DeferredError);
    store.answer("ingest:in_1:ingest.atomize:1", { nothing: true });
    await expect(ask(make())).rejects.toBeInstanceOf(InvalidOutputError);
    expect(store.rows.size).toBe(0);
    await expect(ask(make())).rejects.toBeInstanceOf(DeferredError);
    store.answer("ingest:in_1:ingest.atomize:1", "not json");
    await expect(ask(make())).rejects.toBeInstanceOf(InvalidOutputError);
  });
});

describe("FakeBatchClient", () => {
  const item = async (key: string) => ({
    customId: await customIdOf(key),
    model: "claude-sonnet-5",
    request: {
      instructions: "Make a plan.",
      context: [],
      input: key,
      images: [],
      schema: {},
      maxOutputTokens: 1000,
    },
  });

  it("answers from the scripts once the batch has ended", async () => {
    fake.otherwise((call) =>
      call.input === "b" ? { error: new Error("overloaded") } : { output: { summary: call.input } },
    );
    const client = new FakeBatchClient("anthropic", fake);
    const id = await client.submit([await item("a"), await item("b")]);
    expect(await client.status(id)).toEqual({ state: "running" });
    await expect(client.results(id)).rejects.toThrow(/not ended/);
    client.finish(id);
    expect(await client.status(id)).toEqual({ state: "ended" });
    expect(await client.results(id)).toEqual([
      expect.objectContaining({ ok: true, text: '{"summary":"a"}' }),
      expect.objectContaining({ ok: false, error: "overloaded" }),
    ]);
  });

  it("makes ids the providers accept, the same for the same key", async () => {
    const id = await customIdOf("ingest:in_01ABC:ingest.atomize:1");
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(await customIdOf("ingest:in_01ABC:ingest.atomize:1")).toBe(id);
    expect(await customIdOf("ingest:in_01ABC:ingest.atomize:2")).not.toBe(id);
  });
});
