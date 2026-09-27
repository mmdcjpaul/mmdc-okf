/**
 * Batched processing (AU-6). Model calls that can wait are collected, sent to each
 * provider's batch API every two hours in working hours, and picked up when the provider
 * has answered. The work that asked for them then runs again and finds the answers.
 */
import {
  BudgetExceededError,
  costOf,
  customIdOf,
  type AiSettings,
  type BatchClient,
  type DeferredStore,
  type ModelGateway,
  type ModelPrice,
  type Task,
  type UsageStore,
} from "@lore/ai";
import { newRecordId } from "@lore/changesets";
import {
  createBatch,
  deleteBatchRequests,
  enqueueBatchRequest,
  finishBatch,
  getBatchRequest,
  lastBatchAt,
  openBatches,
  pendingBatchRequests,
  touchBatch,
  type BatchAnswer,
  type Db,
} from "@lore/db";
import type { Logger } from "pino";

export interface BatchDeps {
  db: Db;
  log: Logger;
  /** Batch clients by provider, built from the keys in settings. */
  clients: () => Promise<Map<string, BatchClient>> | Map<string, BatchClient>;
  gateway: ModelGateway;
  settings: () => Promise<AiSettings> | AiSettings;
  usage: UsageStore;
  /** Tells the work that asked (`ingest`, an item id) that its answer is in. */
  onAnswered: (ownerKind: string, ownerId: string) => Promise<void>;
  timeZone: string;
  now?: () => Date;
}

export const BATCH_EVERY_MS = 2 * 3_600_000;
/** Providers promise an answer within a day. After this a batch is given up. */
export const BATCH_GIVE_UP_MS = 26 * 3_600_000;
const WORK_DAY = { from: 8, to: 18 };

/** Monday to Friday, eight to six, in the organization's time zone. */
export function inWorkingHours(now: Date, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  return !["Sat", "Sun"].includes(day) && hour >= WORK_DAY.from && hour < WORK_DAY.to;
}

/** The store the deferring gateway writes to, for one piece of work. */
export function deferredStore(db: Db, owner: { kind: string; id: string }): DeferredStore {
  return {
    async get(key) {
      const row = await getBatchRequest(db, key);
      return row
        ? {
            state: row.state,
            provider: row.provider,
            model: row.model,
            answer: row.answer,
            usage: row.usage,
            error: row.error,
          }
        : null;
    },
    put: (row) => enqueueBatchRequest(db, { ...row, ownerKind: owner.kind, ownerId: owner.id }),
    drop: (key) => deleteBatchRequests(db, [key]),
  };
}

export interface Submitted {
  provider: string;
  batchId: string;
  requests: number;
}

/** Sends what is waiting. `force` ignores the clock, for Process now and for tests. */
export async function submitBatches(
  deps: BatchDeps,
  opts: { force?: boolean } = {},
): Promise<Submitted[]> {
  const now = deps.now?.() ?? new Date();
  if (!opts.force && !inWorkingHours(now, deps.timeZone)) return [];
  const pending = await pendingBatchRequests(deps.db);
  const clients = await deps.clients();
  const out: Submitted[] = [];
  for (const provider of [...new Set(pending.map((r) => r.provider))].sort()) {
    const rows = pending.filter((r) => r.provider === provider);
    const client = clients.get(provider);
    if (!client) {
      // The key was removed, or the provider has no batch API. Whoever waits runs at the
      // normal price when it is tried again.
      await finishWithoutBatch(
        deps,
        rows.map((r) => r.key),
        `${provider} has no batch API here`,
      );
      for (const r of rows) await deps.onAnswered(r.ownerKind, r.ownerId);
      continue;
    }
    const last = await lastBatchAt(deps.db, provider);
    if (!opts.force && last && now.getTime() - last.getTime() < BATCH_EVERY_MS) continue;

    const affordable = [];
    const refused = new Set<string>();
    for (const r of rows) {
      if (refused.has(r.task)) continue;
      try {
        await deps.gateway.checkBudgets(r.task as Task);
        affordable.push(r);
      } catch (err) {
        if (!(err instanceof BudgetExceededError)) throw err;
        refused.add(r.task);
        deps.log.info({ task: r.task, reason: err.message }, "batch requests wait for budget");
      }
    }
    if (affordable.length === 0) continue;
    const items = await Promise.all(
      affordable.map(async (r) => ({
        customId: await customIdOf(r.key),
        model: r.model,
        request: r.request,
      })),
    );
    try {
      const externalId = await client.submit(items);
      const batch = await createBatch(
        deps.db,
        { id: newRecordId("lb", now), provider, externalId, at: now },
        affordable.map((r) => r.key),
      );
      out.push({ provider, batchId: batch.id, requests: affordable.length });
      deps.log.info({ provider, batch: batch.id, requests: affordable.length }, "batch submitted");
    } catch (err) {
      // Left pending: the next window tries again.
      deps.log.warn({ err, provider }, "batch not submitted");
    }
  }
  return out;
}

async function finishWithoutBatch(deps: BatchDeps, keys: string[], error: string): Promise<void> {
  const { db } = deps;
  const at = deps.now?.() ?? new Date();
  for (const key of keys) {
    const row = await getBatchRequest(db, key);
    if (!row) continue;
    await deleteBatchRequests(db, [key]);
    await enqueueBatchRequest(db, {
      ...row,
      state: "failed",
      error,
      finishedAt: at,
    });
  }
}

export interface Polled {
  batchId: string;
  state: "running" | "ended" | "failed";
  answered: number;
  failed: number;
}

/** Asks each provider about the batches that are out, and writes back what has ended. */
export async function pollBatches(deps: BatchDeps): Promise<Polled[]> {
  const now = deps.now?.() ?? new Date();
  const clients = await deps.clients();
  const settings = await deps.settings();
  const out: Polled[] = [];
  for (const batch of await openBatches(deps.db)) {
    const client = clients.get(batch.provider);
    const old = now.getTime() - batch.submittedAt.getTime() > BATCH_GIVE_UP_MS;
    let status: Awaited<ReturnType<BatchClient["status"]>>;
    try {
      status = client
        ? await client.status(batch.externalId)
        : { state: "failed", error: `No key is saved for ${batch.provider}` };
    } catch (err) {
      if (!old) {
        deps.log.warn({ err, batch: batch.id }, "batch status not read");
        continue;
      }
      status = { state: "failed", error: (err as Error).message.slice(0, 300) };
    }
    if (status.state === "running" && old)
      status = { state: "failed", error: "The provider did not answer within a day" };
    if (status.state === "running") {
      await touchBatch(deps.db, batch.id, now);
      out.push({ batchId: batch.id, state: "running", answered: 0, failed: 0 });
      continue;
    }

    const answers: BatchAnswer[] = [];
    if (status.state === "ended" && client) {
      let results: Awaited<ReturnType<BatchClient["results"]>>;
      try {
        results = await client.results(batch.externalId);
      } catch (err) {
        deps.log.warn({ err, batch: batch.id }, "batch results not read");
        continue;
      }
      const keyOf = new Map<string, string>();
      for (const r of await pendingOf(deps.db, batch.id)) keyOf.set(await customIdOf(r.key), r.key);
      for (const r of results) {
        const key = keyOf.get(r.customId);
        if (!key) continue;
        answers.push({
          key,
          ok: r.ok && r.text !== undefined,
          ...(r.text !== undefined ? { answer: r.text } : {}),
          ...(r.usage ? { usage: r.usage } : {}),
          ...(r.error ? { error: r.error.slice(0, 500) } : {}),
        });
      }
    }
    const rows = await finishBatch(deps.db, batch.id, {
      state: status.state === "ended" ? "ended" : "failed",
      ...(status.error ? { error: status.error } : {}),
      answers,
      at: now,
    });
    for (const r of rows) {
      const tokens = r.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      const ref = `${r.provider}:${r.model}`;
      await deps.usage.record({
        task: r.task as Task,
        provider: r.provider,
        model: r.model,
        inputTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite,
        outputTokens: tokens.output,
        cachedTokens: tokens.cacheRead,
        costUsd: costOf(ref, tokens, {
          batch: true,
          prices: settings.prices as Record<string, ModelPrice>,
        }).usd,
        userId: r.userId,
        vaultId: r.vaultId,
        namespace: r.namespace,
        latencyMs: now.getTime() - batch.submittedAt.getTime(),
        batch: true,
        ok: r.state === "done",
        error: r.error,
        at: now,
      });
    }
    const owners = new Map(rows.map((r) => [`${r.ownerKind}:${r.ownerId}`, r]));
    for (const r of owners.values()) await deps.onAnswered(r.ownerKind, r.ownerId);
    const answered = rows.filter((r) => r.state === "done").length;
    out.push({
      batchId: batch.id,
      state: status.state === "ended" ? "ended" : "failed",
      answered,
      failed: rows.length - answered,
    });
    deps.log.info({ batch: batch.id, answered, failed: rows.length - answered }, "batch collected");
  }
  return out;
}

async function pendingOf(db: Db, batchId: string) {
  return db.$client<{ key: string }[]>`
    select key from llm_batch_requests where batch_id = ${batchId}`;
}
