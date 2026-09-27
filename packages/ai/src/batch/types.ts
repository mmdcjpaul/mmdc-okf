/**
 * Provider batch APIs (AU-6): the same requests, answered within a day at about half the
 * price. Each provider's client turns Lore's request into the provider's own and back.
 */
import type { TokenUsage } from "../prices.ts";

/** A request as it is stored while it waits: plain data, with the schema as JSON Schema. */
export interface BatchRequestBody {
  instructions: string;
  context: string[];
  input: string;
  images: { base64: string; mediaType: string }[];
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface BatchItem {
  /** Names the request in the results. Letters, digits, `_` and `-`, up to 64 characters. */
  customId: string;
  model: string;
  request: BatchRequestBody;
}

export interface BatchStatus {
  state: "running" | "ended" | "failed";
  /** Why the batch failed as a whole. */
  error?: string;
}

export interface BatchItemResult {
  customId: string;
  ok: boolean;
  /** The model's answer as JSON text. */
  text?: string;
  usage?: TokenUsage;
  error?: string;
}

export interface BatchClient {
  readonly provider: string;
  /** Returns the provider's id for the batch. */
  submit(items: BatchItem[]): Promise<string>;
  status(batchId: string): Promise<BatchStatus>;
  /** Every request's outcome. Only valid once the status is `ended`. */
  results(batchId: string): Promise<BatchItemResult[]>;
}

/** Providers limit what a custom id may hold, so keys are hashed into one. */
export async function customIdOf(key: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return (
    "lore_" +
    [...new Uint8Array(bytes)]
      .slice(0, 20)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** The largest request that is stored for a batch. Larger ones run at once, at full price. */
export const MAX_BATCH_IMAGE_BYTES = 5 * 1024 * 1024;
