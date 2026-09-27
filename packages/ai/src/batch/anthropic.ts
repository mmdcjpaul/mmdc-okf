import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type {
  BatchClient,
  BatchItem,
  BatchItemResult,
  BatchRequestBody,
  BatchStatus,
} from "./types.ts";

export interface BatchClientOptions {
  apiKey: string;
  /** For tests, which answer from a local server. */
  baseURL?: string;
}

type Params = Anthropic.Messages.MessageCreateParamsNonStreaming;

/** Lore's request as a Messages API request, with the same cache breakpoint as a live call. */
export function anthropicParams(model: string, request: BatchRequestBody): Params {
  const stable = [request.instructions, ...request.context];
  const format = jsonSchemaOutputFormat(request.schema as { type: "object" });
  return {
    model,
    max_tokens: request.maxOutputTokens,
    // Stable text first, with the cache breakpoint on its last block. Requests in a batch
    // that share the instructions and the vocabulary read them from the cache.
    system: stable.map((text, i) => ({
      type: "text" as const,
      text,
      ...(i === stable.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    })),
    messages: [
      {
        role: "user",
        content: [
          ...request.images.map((img) =>
            img.mediaType === "application/pdf"
              ? {
                  type: "document" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "application/pdf" as const,
                    data: img.base64,
                  },
                }
              : {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: img.mediaType as "image/png",
                    data: img.base64,
                  },
                },
          ),
          { type: "text" as const, text: request.input },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: format.schema } },
  };
}

/** Anthropic Message Batches. */
export class AnthropicBatchClient implements BatchClient {
  readonly provider = "anthropic";
  private readonly client: Anthropic;

  constructor(opts: BatchClientOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: 2,
    });
  }

  async submit(items: BatchItem[]): Promise<string> {
    const batch = await this.client.messages.batches.create({
      requests: items.map((i) => ({
        custom_id: i.customId,
        params: anthropicParams(i.model, i.request),
      })),
    });
    return batch.id;
  }

  async status(batchId: string): Promise<BatchStatus> {
    const batch = await this.client.messages.batches.retrieve(batchId);
    return { state: batch.processing_status === "ended" ? "ended" : "running" };
  }

  async results(batchId: string): Promise<BatchItemResult[]> {
    const out: BatchItemResult[] = [];
    for await (const line of await this.client.messages.batches.results(batchId)) {
      const r = line.result;
      if (r.type !== "succeeded") {
        out.push({
          customId: line.custom_id,
          ok: false,
          error:
            r.type === "errored"
              ? `${r.error.error.type}: ${r.error.error.message}`
              : r.type === "expired"
                ? "The batch expired before this request was processed"
                : "The request was cancelled",
        });
        continue;
      }
      const m = r.message;
      const usage = {
        input: m.usage.input_tokens,
        output: m.usage.output_tokens,
        cacheRead: m.usage.cache_read_input_tokens ?? 0,
        cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
      };
      const text = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      if (m.stop_reason === "max_tokens" || m.stop_reason === "refusal" || !text) {
        out.push({
          customId: line.custom_id,
          ok: false,
          usage,
          error:
            m.stop_reason === "max_tokens"
              ? "The answer was cut off at the output limit"
              : m.stop_reason === "refusal"
                ? "The model declined to answer"
                : "The model returned no text",
        });
        continue;
      }
      out.push({ customId: line.custom_id, ok: true, text, usage });
    }
    return out;
  }
}
