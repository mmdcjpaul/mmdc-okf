/**
 * Lets work that calls a model wait for the batch API without being written for it.
 *
 * The work runs with this gateway. At a model call that may be batched, the request is
 * stored and `DeferredError` is thrown: the work stops there. When the batch has answered,
 * the work runs again from the start, and this time the call returns the stored answer and
 * the work goes on to its next call. Work that makes three calls runs four times, which is
 * cheap next to the calls themselves.
 *
 * Calls are named by their order (`<owner>:<task>:<n>`), not by their content, so a vault
 * that changed between two runs does not send the same request twice.
 */
import { z } from "zod";
import { AiUnavailableError, InvalidOutputError } from "../errors.ts";
import type { GenerateInput, Generated, ModelGateway } from "../gateway.ts";
import { costOf, type ModelPrice, type TokenUsage } from "../prices.ts";
import { splitModelRef, taskConfig, type AiSettings, type Task } from "../tasks.ts";
import { MAX_BATCH_IMAGE_BYTES, type BatchRequestBody } from "./types.ts";

/** The part of the gateway that work depends on. */
export type GatewayLike = Pick<ModelGateway, "mode" | "ready" | "generate">;

export class DeferredError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`Waiting for the batch to answer ${key}`);
    this.name = "DeferredError";
    this.key = key;
  }
}

export interface StoredAnswer {
  state: "pending" | "submitted" | "done" | "failed";
  provider: string;
  model: string;
  answer: string | null;
  usage: TokenUsage | null;
  error: string | null;
}

export interface DeferredStore {
  get(key: string): Promise<StoredAnswer | null>;
  put(row: {
    key: string;
    task: Task;
    provider: string;
    model: string;
    request: BatchRequestBody;
    userId: string | null;
    vaultId: string | null;
    namespace: string | null;
  }): Promise<void>;
  /** Forgets an answer that could not be used, so the call can be made again. */
  drop(key: string): Promise<void>;
}

export interface DeferringDeps {
  inner: ModelGateway;
  store: DeferredStore;
  settings: () => Promise<AiSettings> | AiSettings;
  /** Providers whose batch API can be used. */
  batchProviders: ReadonlySet<string>;
  /** `ingest:<item id>`, for example. */
  owner: string;
  /**
   * False when the work was asked to finish now: a call that is still with a batch is made
   * again at once, at the normal price. Answers that are already in are used either way.
   */
  wait?: boolean;
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export class DeferringGateway implements GatewayLike {
  private readonly deps: DeferringDeps;
  private readonly seen = new Map<string, number>();

  constructor(deps: DeferringDeps) {
    this.deps = deps;
  }

  get mode() {
    return this.deps.inner.mode;
  }

  ready(task: Task): Promise<boolean> {
    return this.deps.inner.ready(task);
  }

  async generate<T>(input: GenerateInput<T>): Promise<Generated<T>> {
    const { inner, store } = this.deps;
    const n = (this.seen.get(input.task) ?? 0) + 1;
    this.seen.set(input.task, n);
    const key = `${this.deps.owner}:${input.task}:${n}`;

    const stored = await store.get(key);
    if (stored?.state === "done" && stored.answer !== null) {
      const ref = `${stored.provider}:${stored.model}`;
      let json: unknown;
      try {
        json = JSON.parse(stored.answer);
      } catch (err) {
        await store.drop(key);
        throw new InvalidOutputError("The model's answer was not JSON", { cause: err });
      }
      const parsed = input.schema.safeParse(json);
      if (!parsed.success) {
        await store.drop(key);
        throw new InvalidOutputError("The model's answer did not fit the schema", {
          cause: parsed.error,
        });
      }
      const settings = await this.deps.settings();
      const usage = stored.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      return {
        output: parsed.data,
        model: ref,
        usage,
        costUsd: costOf(ref, usage, {
          batch: true,
          prices: settings.prices as Record<string, ModelPrice>,
        }).usd,
        fellBack: false,
      };
    }
    const waiting = stored?.state === "pending" || stored?.state === "submitted";
    if (waiting && this.deps.wait !== false) throw new DeferredError(key);
    if (waiting) {
      await store.drop(key);
      return inner.generate(input);
    }
    if (stored?.state === "failed") {
      // The batch did not answer this one. It has waited long enough: ask now, at full price.
      await store.drop(key);
      return inner.generate(input);
    }

    const settings = await this.deps.settings();
    const cfg = taskConfig(settings, input.task);
    const { provider, model } = splitModelRef(cfg.primary);
    const imageBytes = (input.images ?? []).reduce((sum, i) => sum + i.bytes.length, 0);
    const batchable =
      cfg.batch && this.deps.batchProviders.has(provider) && imageBytes <= MAX_BATCH_IMAGE_BYTES;
    if (!batchable) return inner.generate(input);
    if (inner.mode === "off") throw new AiUnavailableError("off", "AI is turned off");

    await store.put({
      key,
      task: input.task,
      provider,
      model,
      request: {
        instructions: input.instructions,
        context: input.context ?? [],
        input: input.input,
        images: (input.images ?? []).map((i) => ({
          base64: toBase64(i.bytes),
          mediaType: i.mediaType,
        })),
        schema: z.toJSONSchema(input.schema, { target: "draft-2020-12" }) as Record<
          string,
          unknown
        >,
        maxOutputTokens: input.maxOutputTokens ?? cfg.maxOutputTokens,
      },
      userId: input.userId ?? null,
      vaultId: input.vaultId ?? null,
      namespace: input.namespace ?? null,
    });
    throw new DeferredError(key);
  }
}
