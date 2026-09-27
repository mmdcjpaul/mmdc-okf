import type { z } from "zod";
import { AiUnavailableError, BudgetExceededError, InvalidOutputError } from "./errors.ts";
import { costOf, type ModelPrice, type TokenUsage } from "./prices.ts";
import type { ModelProvider, ModelRequest } from "./provider.ts";
import { splitModelRef, taskConfig, type AiSettings, type Task } from "./tasks.ts";

export type AiMode = "live" | "fake" | "off";

/** One row of `llm_usage`. Written for every call, whether it worked or not. */
export interface UsageRecord {
  task: Task;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  userId: string | null;
  vaultId: string | null;
  namespace: string | null;
  latencyMs: number;
  batch: boolean;
  ok: boolean;
  error: string | null;
  at: Date;
}

/** Where usage is written and budgets are read. The apps supply it, backed by Postgres. */
export interface UsageStore {
  record(row: UsageRecord): Promise<void>;
  /** Dollars spent since `since`, optionally by one task or one person. */
  spentSince(since: Date, filter?: { task?: Task; userId?: string }): Promise<number>;
}

export interface GatewayDeps {
  mode: AiMode;
  provider: ModelProvider;
  settings: () => Promise<AiSettings> | AiSettings;
  usage: UsageStore;
  now?: () => Date;
}

export interface GenerateInput<T> extends Omit<ModelRequest<T>, "maxOutputTokens" | "signal"> {
  task: Task;
  schema: z.ZodType<T>;
  /** Who the call is for, for the person's daily budget and the usage log. */
  userId?: string | null;
  vaultId?: string | null;
  namespace?: string | null;
  maxOutputTokens?: number;
}

export interface Generated<T> {
  output: T;
  /** `<provider>:<model>` that answered, for `generated.by` and the usage log. */
  model: string;
  usage: TokenUsage;
  costUsd: number;
  /** True when the primary failed and the fallback answered. */
  fellBack: boolean;
}

const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const startOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Every model call in Lore goes through here. It picks the model for the task, checks the
 * budgets before spending anything, falls back when the primary fails, and writes one usage
 * row per call.
 *
 * It raises `AiUnavailableError` or `BudgetExceededError`, and callers are expected to catch
 * them and degrade: the Library works with no AI at all (LB-6).
 */
export class ModelGateway {
  private readonly deps: GatewayDeps;

  constructor(deps: GatewayDeps) {
    this.deps = deps;
  }

  get mode(): AiMode {
    return this.deps.mode;
  }

  /** Whether a task can run right now. Budgets are not checked: that needs a database read. */
  async ready(task: Task): Promise<boolean> {
    if (this.deps.mode === "off") return false;
    const cfg = taskConfig(await this.deps.settings(), task);
    return [cfg.primary, cfg.fallback]
      .filter((m): m is string => !!m)
      .some((m) => this.deps.provider.available(splitModelRef(m).provider));
  }

  /** Throws `BudgetExceededError` when a budget that covers this call is used up. */
  async checkBudgets(task: Task, userId?: string | null): Promise<void> {
    const settings = await this.deps.settings();
    const now = this.deps.now?.() ?? new Date();
    const month = startOfMonth(now);
    const { budgets } = settings;
    const org = await this.deps.usage.spentSince(month);
    if (org >= budgets.orgMonthlyUsd)
      throw new BudgetExceededError("organization", budgets.orgMonthlyUsd, org, "The organization");
    const limit = taskConfig(settings, task).budgetUsd;
    if (limit !== undefined) {
      const spent = await this.deps.usage.spentSince(month, { task });
      if (spent >= limit) throw new BudgetExceededError("task", limit, spent, `The task ${task}`);
    }
    if (userId) {
      const spent = await this.deps.usage.spentSince(startOfDay(now), { userId });
      if (spent >= budgets.personDailyUsd)
        throw new BudgetExceededError("person", budgets.personDailyUsd, spent, "This person");
    }
  }

  async generate<T>(input: GenerateInput<T>): Promise<Generated<T>> {
    const { provider, usage } = this.deps;
    if (this.deps.mode === "off") throw new AiUnavailableError("off", "AI is turned off");
    const settings = await this.deps.settings();
    const cfg = taskConfig(settings, input.task);
    const candidates = [cfg.primary, cfg.fallback]
      .filter((m): m is string => !!m)
      .filter((m) => provider.available(splitModelRef(m).provider));
    if (candidates.length === 0)
      throw new AiUnavailableError(
        "not_configured",
        `No provider key is configured for ${input.task} (${cfg.primary})`,
      );
    await this.checkBudgets(input.task, input.userId);

    let last: unknown;
    for (const [i, ref] of candidates.entries()) {
      const { provider: p, model } = splitModelRef(ref);
      const started = Date.now();
      const timeout = AbortSignal.timeout(cfg.timeoutMs);
      const row = (ok: boolean, tokens: TokenUsage, error: string | null): UsageRecord => ({
        task: input.task,
        provider: p,
        model,
        inputTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite,
        outputTokens: tokens.output,
        cachedTokens: tokens.cacheRead,
        costUsd: costOf(ref, tokens, {
          prices: settings.prices as Record<string, ModelPrice>,
        }).usd,
        userId: input.userId ?? null,
        vaultId: input.vaultId ?? null,
        namespace: input.namespace ?? null,
        latencyMs: Date.now() - started,
        batch: false,
        ok,
        error,
        at: this.deps.now?.() ?? new Date(),
      });
      try {
        const res = await provider.generate(p, model, {
          instructions: input.instructions,
          ...(input.context ? { context: input.context } : {}),
          input: input.input,
          ...(input.images ? { images: input.images } : {}),
          schema: input.schema,
          maxOutputTokens: input.maxOutputTokens ?? cfg.maxOutputTokens,
          signal: timeout,
        });
        const record = row(true, res.usage, null);
        await usage.record(record);
        return {
          output: res.output,
          model: ref,
          usage: res.usage,
          costUsd: record.costUsd,
          fellBack: i > 0,
        };
      } catch (err) {
        last = err;
        const message = timeout.aborted
          ? `Timed out after ${cfg.timeoutMs} ms`
          : ((err as Error).message ?? String(err)).slice(0, 500);
        await usage.record(
          row(false, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, message),
        );
      }
    }
    if (last instanceof InvalidOutputError) throw last;
    throw new AiUnavailableError(
      "failed",
      `${input.task} failed on ${candidates.join(" and ")}: ${(last as Error)?.message ?? last}`,
      { cause: last },
    );
  }
}
