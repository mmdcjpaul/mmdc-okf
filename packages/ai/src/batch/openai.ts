import OpenAI, { toFile } from "openai";
import type { BatchClientOptions } from "./anthropic.ts";
import type {
  BatchClient,
  BatchItem,
  BatchItemResult,
  BatchRequestBody,
  BatchStatus,
} from "./types.ts";

type Body = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

export function openaiBody(model: string, request: BatchRequestBody): Body {
  return {
    model,
    max_completion_tokens: request.maxOutputTokens,
    messages: [
      // OpenAI caches a repeated prefix by itself, so the stable text goes first.
      ...[request.instructions, ...request.context].map((content) => ({
        role: "developer" as const,
        content,
      })),
      {
        role: "user",
        content: [
          ...request.images.map((img, i) =>
            img.mediaType === "application/pdf"
              ? {
                  type: "file" as const,
                  file: {
                    filename: `document-${i + 1}.pdf`,
                    file_data: `data:application/pdf;base64,${img.base64}`,
                  },
                }
              : {
                  type: "image_url" as const,
                  image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
                },
          ),
          { type: "text" as const, text: request.input },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      // Not strict: strict mode wants every property required, and Lore's schemas have
      // defaults. The answer is checked against the real schema when it is read.
      json_schema: { name: "answer", schema: request.schema, strict: false },
    },
  };
}

interface OutputLine {
  custom_id: string;
  response?: {
    status_code: number;
    body?: {
      choices?: {
        message?: { content?: string | null; refusal?: string | null };
        finish_reason?: string;
      }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
      error?: { message?: string };
    };
  } | null;
  error?: { code?: string; message?: string } | null;
}

/** The OpenAI Batch API: a JSONL file of requests in, a JSONL file of answers out. */
export class OpenAiBatchClient implements BatchClient {
  readonly provider = "openai";
  private readonly client: OpenAI;

  constructor(opts: BatchClientOptions) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: 2,
    });
  }

  async submit(items: BatchItem[]): Promise<string> {
    const lines = items.map((i) =>
      JSON.stringify({
        custom_id: i.customId,
        method: "POST",
        url: "/v1/chat/completions",
        body: openaiBody(i.model, i.request),
      }),
    );
    const file = await this.client.files.create({
      file: await toFile(Buffer.from(lines.join("\n") + "\n"), "lore-batch.jsonl", {
        type: "application/jsonl",
      }),
      purpose: "batch",
    });
    const batch = await this.client.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    });
    return batch.id;
  }

  async status(batchId: string): Promise<BatchStatus> {
    const batch = await this.client.batches.retrieve(batchId);
    // An expired or cancelled batch still has the answers that were ready in time.
    if (["completed", "expired", "cancelled"].includes(batch.status)) return { state: "ended" };
    if (batch.status === "failed")
      return {
        state: "failed",
        error:
          batch.errors?.data?.map((e) => e.message).join("; ") ||
          "OpenAI could not process the batch",
      };
    return { state: "running" };
  }

  private async lines(fileId: string | null | undefined): Promise<OutputLine[]> {
    if (!fileId) return [];
    const text = await (await this.client.files.content(fileId)).text();
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as OutputLine);
  }

  async results(batchId: string): Promise<BatchItemResult[]> {
    const batch = await this.client.batches.retrieve(batchId);
    const all = [
      ...(await this.lines(batch.output_file_id)),
      ...(await this.lines(batch.error_file_id)),
    ];
    return all.map((line): BatchItemResult => {
      const body = line.response?.body;
      const u = body?.usage;
      const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
      const usage = u
        ? {
            input: Math.max(0, (u.prompt_tokens ?? 0) - cached),
            output: u.completion_tokens ?? 0,
            cacheRead: cached,
            cacheWrite: 0,
          }
        : undefined;
      const choice = body?.choices?.[0];
      const failed =
        line.error?.message ??
        (line.response && line.response.status_code >= 400
          ? (body?.error?.message ?? `OpenAI answered ${line.response.status_code}`)
          : null) ??
        (choice?.message?.refusal ? "The model declined to answer" : null) ??
        (choice?.finish_reason === "length"
          ? "The answer was cut off at the output limit"
          : null) ??
        (choice?.message?.content ? null : "The model returned no text");
      return failed
        ? { customId: line.custom_id, ok: false, error: failed, ...(usage ? { usage } : {}) }
        : {
            customId: line.custom_id,
            ok: true,
            text: choice!.message!.content!,
            ...(usage ? { usage } : {}),
          };
    });
  }
}
