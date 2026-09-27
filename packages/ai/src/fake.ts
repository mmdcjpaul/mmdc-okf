import { InvalidOutputError } from "./errors.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "./provider.ts";

export interface RecordedCall {
  provider: string;
  model: string;
  instructions: string;
  context: string[];
  input: string;
  images: number;
}

export type Script =
  /** The object the model returns. Validated against the request's schema like a real answer. */
  | { output: unknown; usage?: Partial<ModelResponse<unknown>["usage"]> }
  | { error: Error }
  /** Never answers, so the gateway's timeout fires. */
  | { hang: true };

export type ScriptFor = (call: RecordedCall) => Script | undefined;

/**
 * A model that replays scripted answers and records every call (`AI_MODE=fake`). Tests use
 * it to say exactly what the model returns, including answers a real model should never
 * give, such as a plan that writes to a namespace the submitter cannot read.
 */
export class FakeModelProvider implements ModelProvider {
  readonly calls: RecordedCall[] = [];
  private readonly queue: (Script | ScriptFor)[] = [];
  private fallbackScript: ScriptFor | null = null;

  /** Answers the next call with this. */
  enqueue(...scripts: (Script | ScriptFor)[]): this {
    this.queue.push(...scripts);
    return this;
  }

  /** Answers any call the queue has nothing for. */
  otherwise(script: ScriptFor): this {
    this.fallbackScript = script;
    return this;
  }

  available(): boolean {
    return true;
  }

  async generate<T>(
    provider: string,
    model: string,
    request: ModelRequest<T>,
  ): Promise<ModelResponse<T>> {
    const call: RecordedCall = {
      provider,
      model,
      instructions: request.instructions,
      context: request.context ?? [],
      input: request.input,
      images: request.images?.length ?? 0,
    };
    this.calls.push(call);
    const next = this.queue.shift() ?? this.fallbackScript;
    const script = typeof next === "function" ? next(call) : next;
    if (!script) throw new Error(`FakeModelProvider has no script for call ${this.calls.length}`);
    if ("hang" in script) {
      return new Promise((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(request.signal!.reason));
      });
    }
    if ("error" in script) throw script.error;
    const parsed = request.schema.safeParse(script.output);
    if (!parsed.success)
      throw new InvalidOutputError(
        `The scripted output does not fit the schema: ${parsed.error.message}`,
      );
    return {
      output: parsed.data,
      usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, ...script.usage },
    };
  }
}
