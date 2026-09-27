import { z } from "zod";
import type { FakeModelProvider } from "../fake.ts";
import type { BatchClient, BatchItem, BatchItemResult, BatchStatus } from "./types.ts";

/**
 * A batch API that answers from the scripted model (`AI_MODE=fake`). A batch stays running
 * until `finish` is called, or ends at once when built with `immediate`.
 */
export class FakeBatchClient implements BatchClient {
  readonly provider: string;
  readonly batches = new Map<string, { items: BatchItem[]; state: BatchStatus["state"] }>();
  private readonly model: FakeModelProvider;
  private readonly immediate: boolean;

  constructor(provider: string, model: FakeModelProvider, opts: { immediate?: boolean } = {}) {
    this.provider = provider;
    this.model = model;
    this.immediate = opts.immediate ?? false;
  }

  async submit(items: BatchItem[]): Promise<string> {
    if (items.length === 0) throw new Error("A batch needs at least one request");
    const id = `fakebatch_${this.batches.size + 1}`;
    this.batches.set(id, { items, state: this.immediate ? "ended" : "running" });
    return id;
  }

  /** Ends a batch, or every running batch. */
  finish(id?: string, state: BatchStatus["state"] = "ended"): void {
    for (const [key, batch] of this.batches)
      if ((!id || key === id) && batch.state === "running") batch.state = state;
  }

  async status(batchId: string): Promise<BatchStatus> {
    const batch = this.batches.get(batchId);
    if (!batch) return { state: "failed", error: "No such batch" };
    return batch.state === "failed"
      ? { state: "failed", error: "The provider could not process the batch" }
      : { state: batch.state };
  }

  async results(batchId: string): Promise<BatchItemResult[]> {
    const batch = this.batches.get(batchId);
    if (!batch || batch.state !== "ended") throw new Error("The batch has not ended");
    const out: BatchItemResult[] = [];
    for (const item of batch.items) {
      try {
        const res = await this.model.generate(this.provider, item.model, {
          instructions: item.request.instructions,
          context: item.request.context,
          input: item.request.input,
          images: item.request.images.map((i) => ({
            bytes: Buffer.from(i.base64, "base64"),
            mediaType: i.mediaType,
          })),
          // The answer is checked against the real schema by whoever asked.
          schema: z.unknown(),
          maxOutputTokens: item.request.maxOutputTokens,
        });
        out.push({
          customId: item.customId,
          ok: true,
          text: JSON.stringify(res.output),
          usage: res.usage,
        });
      } catch (err) {
        out.push({ customId: item.customId, ok: false, error: (err as Error).message });
      }
    }
    return out;
  }
}
