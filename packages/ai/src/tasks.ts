import { z } from "zod";

/** Every place Lore calls a model. Tasks name their models in settings, not in code. */
export const TASKS = [
  "desk.classify",
  "desk.rewrite",
  "desk.answer.single",
  "desk.answer.multi",
  "desk.intake",
  "ingest.extract",
  "ingest.atomize",
  "ingest.doc2query",
  "gardener.propose",
] as const;
export type Task = (typeof TASKS)[number];

/** `<provider>:<model>`, for example `anthropic:claude-sonnet-5`. */
export const ModelRef = z.string().regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._/:-]*$/);

export const TaskConfig = z.object({
  primary: ModelRef,
  /** Used when the primary errors, times out, or is rate limited. */
  fallback: ModelRef.optional(),
  /** May wait for the provider's batch API, at about half the price. */
  batch: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(600_000).default(60_000),
  maxOutputTokens: z.number().int().positive().max(128_000).default(16_000),
  /** Monthly ceiling for this task, in US dollars. */
  budgetUsd: z.number().nonnegative().optional(),
});
export type TaskConfig = z.infer<typeof TaskConfig>;

export const Budgets = z.object({
  /** The whole organization, per calendar month. */
  orgMonthlyUsd: z.number().nonnegative().default(150),
  /** Share of the monthly budget at which admins are warned. */
  alertAt: z.number().min(0).max(1).default(0.8),
  /** One person, per day. */
  personDailyUsd: z.number().nonnegative().default(2),
});
export type Budgets = z.infer<typeof Budgets>;

const HAIKU = "anthropic:claude-haiku-4-5";
const SONNET = "anthropic:claude-sonnet-5";

/** The starting configuration from TECH_STACK section 12. Admins change it in settings. */
export const DEFAULT_TASKS: Record<Task, TaskConfig> = {
  "desk.classify": TaskConfig.parse({ primary: HAIKU, timeoutMs: 15_000, maxOutputTokens: 1_000 }),
  "desk.rewrite": TaskConfig.parse({ primary: HAIKU, timeoutMs: 15_000, maxOutputTokens: 1_000 }),
  "desk.answer.single": TaskConfig.parse({ primary: HAIKU, timeoutMs: 45_000 }),
  "desk.answer.multi": TaskConfig.parse({ primary: SONNET, timeoutMs: 90_000 }),
  "desk.intake": TaskConfig.parse({ primary: HAIKU, timeoutMs: 30_000, maxOutputTokens: 4_000 }),
  "ingest.extract": TaskConfig.parse({ primary: SONNET, batch: true, timeoutMs: 300_000 }),
  "ingest.atomize": TaskConfig.parse({
    primary: SONNET,
    batch: true,
    timeoutMs: 300_000,
    maxOutputTokens: 32_000,
  }),
  "ingest.doc2query": TaskConfig.parse({ primary: HAIKU, batch: true, maxOutputTokens: 2_000 }),
  "gardener.propose": TaskConfig.parse({ primary: SONNET, batch: true, timeoutMs: 300_000 }),
};

export const PROVIDERS = ["anthropic", "openai", "google", "openrouter"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const AiSettings = z.object({
  tasks: z.partialRecord(z.enum(TASKS), TaskConfig).default({}),
  budgets: Budgets.default(Budgets.parse({})),
  /** Provider keys, encrypted with the app key. Never returned by any API. */
  keys: z.partialRecord(z.enum(PROVIDERS), z.string()).default({}),
  /** Prices for models the built-in table does not know, per million tokens. */
  prices: z
    .record(
      ModelRef,
      z.object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative().default(0),
        cacheWrite: z.number().nonnegative().default(0),
        batch: z.number().min(0).max(1).default(1),
      }),
    )
    .default({}),
  embeddings: z
    .object({ model: ModelRef, dimensions: z.number().int().positive().default(1024) })
    .optional(),
});
export type AiSettings = z.infer<typeof AiSettings>;

export function taskConfig(settings: AiSettings, task: Task): TaskConfig {
  return settings.tasks[task] ?? DEFAULT_TASKS[task];
}

export function splitModelRef(ref: string): { provider: string; model: string } {
  const at = ref.indexOf(":");
  return { provider: ref.slice(0, at), model: ref.slice(at + 1) };
}
