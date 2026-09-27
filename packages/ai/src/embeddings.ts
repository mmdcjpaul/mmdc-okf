import { createHash } from "node:crypto";

/** Turns text into vectors. Every embedder used for one index must share `model` and `dimensions`. */
export interface Embedder {
  /** Cache key for `embedding_cache`, for example `hash-1024` or `voyage-3.5@1024`. */
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Raised when no embedding provider can answer. Callers fall back to keyword search (LB-6). */
export class EmbeddingUnavailableError extends Error {
  constructor(message = "Embeddings are unavailable") {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

/**
 * Deterministic feature hashing (`EMBEDDINGS=hash`). Words and word pairs are hashed into a
 * signed bag of features and L2-normalized. Semantically weak, but stable across runs, free,
 * and good enough to exercise hybrid search in tests and on laptops.
 */
export class HashEmbedder implements Embedder {
  readonly dimensions: number;
  readonly model: string;

  constructor(dimensions = 1024) {
    this.dimensions = dimensions;
    this.model = `hash-${dimensions}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const v = new Float64Array(this.dimensions);
    const words = (text.toLowerCase().match(WORD_RE) ?? []).filter((w) => w.length > 1);
    const add = (feature: string, weight: number) => {
      const h = createHash("sha1").update(feature).digest();
      const idx = h.readUInt32BE(0) % this.dimensions;
      v[idx] = v[idx]! + (h[4]! & 1 ? weight : -weight);
    };
    for (let i = 0; i < words.length; i++) {
      add(words[i]!, 1);
      if (i + 1 < words.length) add(`${words[i]} ${words[i + 1]}`, 0.5);
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return Array.from(v, (x) => Math.round((x / norm) * 1e6) / 1e6);
  }
}

/** An embedder that always fails, for testing the keyword-only fallback. */
export class FailingEmbedder implements Embedder {
  readonly model = "failing";
  readonly dimensions = 1024;
  async embed(): Promise<number[][]> {
    throw new EmbeddingUnavailableError();
  }
}

export type EmbeddingsMode = "hash" | "off" | "fail";

/** Picks the embedder for `EMBEDDINGS`. `local` and `provider` arrive with the AI core (L8). */
export function embedderFor(mode: string | undefined): Embedder | null {
  switch (mode ?? "hash") {
    case "hash":
      return new HashEmbedder();
    case "fail":
      return new FailingEmbedder();
    case "off":
      return null;
    default:
      throw new Error(`EMBEDDINGS=${mode} is not supported yet; use hash, off, or fail`);
  }
}
