import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiSettings,
  AiUnavailableError,
  BudgetExceededError,
  FakeModelProvider,
  InvalidOutputError,
  ModelGateway,
  type AiMode,
  type ModelProvider,
  type Task,
  type UsageRecord,
  type UsageStore,
} from "../src/index.ts";

const NOW = new Date("2026-09-24T10:00:00Z");
const Answer = z.object({ label: z.string() });

class MemoryUsage implements UsageStore {
  rows: UsageRecord[] = [];
  async record(row: UsageRecord) {
    this.rows.push(row);
  }
  async spentSince(since: Date, filter: { task?: Task; userId?: string } = {}) {
    return this.rows
      .filter((r) => r.at >= since)
      .filter((r) => !filter.task || r.task === filter.task)
      .filter((r) => !filter.userId || r.userId === filter.userId)
      .reduce((s, r) => s + r.costUsd, 0);
  }
}

let fake: FakeModelProvider;
let usage: MemoryUsage;
const gateway = (over: { mode?: AiMode; settings?: unknown; provider?: ModelProvider } = {}) =>
  new ModelGateway({
    mode: over.mode ?? "fake",
    provider: over.provider ?? fake,
    settings: () => AiSettings.parse(over.settings ?? {}),
    usage,
    now: () => NOW,
  });
const ask = (g: ModelGateway, over: Record<string, unknown> = {}) =>
  g.generate({
    task: "desk.classify",
    instructions: "Classify the message.",
    context: ["Intents: question, request."],
    input: "How do I enroll?",
    schema: Answer,
    userId: "alice",
    ...over,
  });

beforeEach(() => {
  fake = new FakeModelProvider();
  usage = new MemoryUsage();
});

describe("ModelGateway", () => {
  it("calls the task's model and logs one usage row", async () => {
    fake.enqueue({
      output: { label: "question" },
      usage: { input: 200, output: 20, cacheRead: 1800, cacheWrite: 0 },
    });
    const res = await ask(gateway(), { vaultId: "acme", namespace: "admissions" });
    expect(res).toMatchObject({
      output: { label: "question" },
      model: "anthropic:claude-haiku-4-5",
      fellBack: false,
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(usage.rows).toHaveLength(1);
    expect(usage.rows[0]).toMatchObject({
      task: "desk.classify",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 2000,
      cachedTokens: 1800,
      outputTokens: 20,
      userId: "alice",
      vaultId: "acme",
      namespace: "admissions",
      ok: true,
      batch: false,
    });
    // 200 at $1, 1800 cached at $0.10, 20 out at $5, per million.
    expect(usage.rows[0]!.costUsd).toBeCloseTo((200 * 1 + 1800 * 0.1 + 20 * 5) / 1e6, 9);
  });

  it("uses the model the settings name for the task", async () => {
    fake.enqueue({ output: { label: "x" } });
    const g = gateway({
      settings: { tasks: { "desk.classify": { primary: "openai:a-mini-model" } } },
    });
    expect((await ask(g)).model).toBe("openai:a-mini-model");
  });

  it("falls back when the primary fails, and logs both calls", async () => {
    fake.enqueue({ error: new Error("529 overloaded") }, { output: { label: "request" } });
    const g = gateway({
      settings: {
        tasks: {
          "desk.classify": {
            primary: "anthropic:claude-haiku-4-5",
            fallback: "google:a-flash-model",
          },
        },
      },
    });
    const res = await ask(g);
    expect(res).toMatchObject({ model: "google:a-flash-model", fellBack: true });
    expect(usage.rows.map((r) => [r.provider, r.ok, r.error])).toEqual([
      ["anthropic", false, "529 overloaded"],
      ["google", true, null],
    ]);
  });

  it("falls back when the primary times out", async () => {
    fake.enqueue({ hang: true }, { output: { label: "late" } });
    const g = gateway({
      settings: {
        tasks: {
          "desk.classify": {
            primary: "anthropic:claude-haiku-4-5",
            fallback: "openai:a-mini-model",
            timeoutMs: 50,
          },
        },
      },
    });
    expect((await ask(g)).output).toEqual({ label: "late" });
    expect(usage.rows[0]).toMatchObject({ ok: false, error: "Timed out after 50 ms" });
  });

  it("raises AiUnavailableError when every model fails, so callers can degrade", async () => {
    fake.enqueue({ error: new Error("boom") }, { error: new Error("bust") });
    const g = gateway({
      settings: { tasks: { "desk.classify": { primary: "anthropic:a", fallback: "openai:b" } } },
    });
    const err = await ask(g).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err).toMatchObject({ reason: "failed" });
    expect((err as Error).message).toContain("bust");
    expect(usage.rows).toHaveLength(2);
  });

  it("skips a provider with no key, and is unavailable when none has one", async () => {
    const keyed: ModelProvider = {
      available: (p) => p === "openai",
      generate: (p, m, r) => fake.generate(p, m, r),
    };
    fake.enqueue({ output: { label: "x" } });
    const g = gateway({
      provider: keyed,
      settings: { tasks: { "desk.classify": { primary: "anthropic:a", fallback: "openai:b" } } },
    });
    expect((await ask(g)).model).toBe("openai:b");
    expect(fake.calls).toHaveLength(1);

    const none = gateway({ provider: { ...keyed, available: () => false } });
    await expect(ask(none)).rejects.toMatchObject({ reason: "not_configured" });
    expect(await none.ready("desk.classify")).toBe(false);
  });

  it("makes no call at all when AI is off", async () => {
    const g = gateway({ mode: "off" });
    await expect(ask(g)).rejects.toMatchObject({ name: "AiUnavailableError", reason: "off" });
    expect(await g.ready("ingest.atomize")).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(usage.rows).toEqual([]);
  });

  it("reports an answer that does not fit the schema as invalid, not as unavailable", async () => {
    fake.enqueue({ output: { wrong: true } });
    await expect(ask(gateway())).rejects.toBeInstanceOf(InvalidOutputError);
    expect(usage.rows[0]).toMatchObject({ ok: false });
  });
});

describe("budgets", () => {
  const spend = (over: Partial<UsageRecord>) =>
    usage.rows.push({
      task: "desk.classify",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 1,
      userId: "bob",
      vaultId: null,
      namespace: null,
      latencyMs: 1,
      batch: false,
      ok: true,
      error: null,
      at: new Date("2026-09-10T00:00:00Z"),
      ...over,
    });

  it("refuses before calling when the organization's month is spent", async () => {
    spend({ costUsd: 150 });
    const err = await ask(gateway()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toMatchObject({ scope: "organization", limitUsd: 150, spentUsd: 150 });
    expect(fake.calls).toEqual([]);
  });

  it("counts only this month", async () => {
    spend({ costUsd: 500, at: new Date("2026-08-31T23:59:59Z") });
    fake.enqueue({ output: { label: "x" } });
    await expect(ask(gateway())).resolves.toBeDefined();
  });

  it("refuses when the task's budget is spent, and lets other tasks run", async () => {
    spend({ costUsd: 5, task: "desk.classify" });
    const settings = {
      tasks: { "desk.classify": { primary: "anthropic:claude-haiku-4-5", budgetUsd: 5 } },
    };
    await expect(ask(gateway({ settings }))).rejects.toMatchObject({ scope: "task" });
    fake.enqueue({ output: { label: "x" } });
    await expect(ask(gateway({ settings }), { task: "desk.intake" })).resolves.toBeDefined();
  });

  it("refuses when the person's day is spent, and lets other people run", async () => {
    spend({ costUsd: 2, userId: "alice", at: new Date("2026-09-24T08:00:00Z") });
    await expect(ask(gateway())).rejects.toMatchObject({ scope: "person", limitUsd: 2 });
    fake.enqueue({ output: { label: "x" } }, { output: { label: "y" } });
    await expect(ask(gateway(), { userId: "carol" })).resolves.toBeDefined();
    // Yesterday's spending does not count against today.
    usage.rows.length = 0;
    spend({ costUsd: 2, userId: "alice", at: new Date("2026-09-23T23:00:00Z") });
    await expect(ask(gateway())).resolves.toBeDefined();
  });
});
