import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
  type ModelMessage,
  type SystemModelMessage,
} from "ai";
import { InvalidOutputError } from "./errors.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "./provider.ts";

/** Marks the end of a cacheable prefix for Anthropic. Other providers cache prefixes on their own. */
const CACHE = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

/** Builds the model object for a model id. */
export type ModelFactory = (model: string) => LanguageModel;
type Factory = ModelFactory;

/**
 * Models reached through the AI SDK, built from the company's own keys. Keys are passed in
 * already decrypted and live only in this object's memory.
 */
export class AiSdkModelProvider implements ModelProvider {
  private readonly factories = new Map<string, Factory>();

  /**
   * @param keys Decrypted provider keys.
   * @param factories Replaces or adds providers, for tests and for providers not built in.
   */
  constructor(keys: Partial<Record<string, string>>, factories: Record<string, ModelFactory> = {}) {
    if (keys.anthropic) {
      const p = createAnthropic({ apiKey: keys.anthropic });
      this.factories.set("anthropic", (m) => p(m));
    }
    if (keys.openai) {
      const p = createOpenAI({ apiKey: keys.openai });
      this.factories.set("openai", (m) => p(m));
    }
    if (keys.google) {
      const p = createGoogleGenerativeAI({ apiKey: keys.google });
      this.factories.set("google", (m) => p(m));
    }
    if (keys.openrouter) {
      const p = createOpenRouter({ apiKey: keys.openrouter });
      this.factories.set("openrouter", (m) => p(m) as unknown as LanguageModel);
    }
    for (const [name, factory] of Object.entries(factories)) this.factories.set(name, factory);
  }

  available(provider: string): boolean {
    return this.factories.has(provider);
  }

  async generate<T>(
    provider: string,
    model: string,
    request: ModelRequest<T>,
  ): Promise<ModelResponse<T>> {
    const factory = this.factories.get(provider);
    if (!factory) throw new Error(`No key is configured for ${provider}`);

    // Stable content first, with a cache breakpoint after the last stable block: the
    // instructions, then the context. The input comes after it and is never cached.
    const stable = [request.instructions, ...(request.context ?? [])];
    const instructions: SystemModelMessage[] = stable.map((content, i) => ({
      role: "system",
      content,
      ...(i === stable.length - 1 ? { providerOptions: CACHE } : {}),
    }));
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          ...(request.images ?? []).map((img) => ({
            type: "file" as const,
            data: img.bytes,
            mediaType: img.mediaType,
          })),
          { type: "text" as const, text: request.input },
        ],
      },
    ];

    try {
      const result = await generateText({
        model: factory(model),
        instructions,
        messages,
        output: Output.object({ schema: request.schema }),
        maxOutputTokens: request.maxOutputTokens,
        // The gateway owns retries and fallbacks; one layer of them is enough.
        maxRetries: 1,
        ...(request.signal ? { abortSignal: request.signal } : {}),
      });
      const read = result.usage.inputTokenDetails.cacheReadTokens ?? 0;
      const written = result.usage.inputTokenDetails.cacheWriteTokens ?? 0;
      const total = result.usage.inputTokens ?? 0;
      return {
        output: result.output as T,
        usage: {
          input:
            result.usage.inputTokenDetails.noCacheTokens ?? Math.max(0, total - read - written),
          output: result.usage.outputTokens ?? 0,
          cacheRead: read,
          cacheWrite: written,
        },
      };
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err))
        throw new InvalidOutputError("The model's answer did not fit the schema", { cause: err });
      throw err;
    }
  }
}
