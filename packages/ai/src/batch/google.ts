import { GoogleGenAI, type InlinedRequest } from "@google/genai";
import type { BatchClientOptions } from "./anthropic.ts";
import type {
  BatchClient,
  BatchItem,
  BatchItemResult,
  BatchRequestBody,
  BatchStatus,
} from "./types.ts";

const ID = "lore_id";
const RUNNING = new Set([
  "JOB_STATE_UNSPECIFIED",
  "JOB_STATE_QUEUED",
  "JOB_STATE_PENDING",
  "JOB_STATE_RUNNING",
  "JOB_STATE_CANCELLING",
  "JOB_STATE_PAUSED",
]);

export function googleRequest(customId: string, request: BatchRequestBody): InlinedRequest {
  return {
    metadata: { [ID]: customId },
    contents: [
      {
        role: "user",
        parts: [
          ...request.images.map((img) => ({
            inlineData: { mimeType: img.mediaType, data: img.base64 },
          })),
          { text: request.input },
        ],
      },
    ],
    config: {
      systemInstruction: {
        parts: [request.instructions, ...request.context].map((text) => ({ text })),
      },
      maxOutputTokens: request.maxOutputTokens,
      responseMimeType: "application/json",
      responseJsonSchema: request.schema,
    },
  };
}

/**
 * Gemini batch mode. A job is for one model, so requests for several models become several
 * jobs, and the id Lore keeps is the jobs' names joined by commas.
 */
export class GoogleBatchClient implements BatchClient {
  readonly provider = "google";
  private readonly client: GoogleGenAI;

  constructor(opts: BatchClientOptions) {
    this.client = new GoogleGenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { httpOptions: { baseUrl: opts.baseURL } } : {}),
    });
  }

  async submit(items: BatchItem[]): Promise<string> {
    const names: string[] = [];
    for (const model of [...new Set(items.map((i) => i.model))].sort()) {
      const job = await this.client.batches.create({
        model,
        src: items
          .filter((i) => i.model === model)
          .map((i) => googleRequest(i.customId, i.request)),
        config: { displayName: `lore-${model}` },
      });
      if (!job.name) throw new Error("Gemini did not name the batch job");
      names.push(job.name);
    }
    return names.join(",");
  }

  private jobs(batchId: string) {
    return Promise.all(batchId.split(",").map((name) => this.client.batches.get({ name })));
  }

  async status(batchId: string): Promise<BatchStatus> {
    const jobs = await this.jobs(batchId);
    if (jobs.some((j) => RUNNING.has(j.state ?? "JOB_STATE_UNSPECIFIED")))
      return { state: "running" };
    // Jobs that failed as a whole have no answers; their requests are reported by `results`
    // as missing, and the caller asks again at the normal price.
    if (jobs.every((j) => j.state !== "JOB_STATE_SUCCEEDED"))
      return {
        state: "failed",
        error: jobs.map((j) => j.error?.message ?? j.state).join("; "),
      };
    return { state: "ended" };
  }

  async results(batchId: string): Promise<BatchItemResult[]> {
    const out: BatchItemResult[] = [];
    for (const job of await this.jobs(batchId)) {
      for (const r of job.dest?.inlinedResponses ?? []) {
        const customId = r.metadata?.[ID];
        if (!customId) continue;
        const u = r.response?.usageMetadata;
        const cached = u?.cachedContentTokenCount ?? 0;
        const usage = u
          ? {
              input: Math.max(0, (u.promptTokenCount ?? 0) - cached),
              output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
              cacheRead: cached,
              cacheWrite: 0,
            }
          : undefined;
        const candidate = r.response?.candidates?.[0];
        const text = (candidate?.content?.parts ?? [])
          .filter((p) => !p.thought && typeof p.text === "string")
          .map((p) => p.text)
          .join("");
        const failed =
          r.error?.message ??
          (candidate?.finishReason === "MAX_TOKENS"
            ? "The answer was cut off at the output limit"
            : null) ??
          (text ? null : `The model returned no text (${candidate?.finishReason ?? "no answer"})`);
        out.push(
          failed
            ? { customId, ok: false, error: failed, ...(usage ? { usage } : {}) }
            : { customId, ok: true, text, ...(usage ? { usage } : {}) },
        );
      }
    }
    return out;
  }
}
