import { createHash } from "node:crypto";

/** Turns text into vectors. Every embedder used for one index must share `model` and `dimensions`. */
export interface Embedder {
  /** Cache key for `embedding_cache`, for example `hash-1024` or `voyage-3.5@1024`. */
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
  /**
   * Embeds a search query, for models that treat queries and passages differently.
   * Callers use `embed` when this is absent.
   */
  embedQuery?(text: string): Promise<number[]>;
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

export interface LocalEmbedderOptions {
  /** A Hugging Face model with ONNX weights and 1,024-dimensional output. */
  model?: string;
  /** Prefix the model expects on search queries. Passages get none. */
  queryPrefix?: string;
  /** Where downloaded weights are kept. Defaults to the library's cache folder. */
  cacheDir?: string;
  dimensions?: number;
}

export const LOCAL_EMBEDDING_MODEL = "mixedbread-ai/mxbai-embed-large-v1";
const LOCAL_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

type Extractor = (
  texts: string[],
  opts: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * A model run on this machine with transformers.js (`EMBEDDINGS=local`): real semantic
 * vectors with no provider, no key, and nothing leaving the host. The weights (a few hundred
 * megabytes) download on first use; after that it works offline.
 */
export class LocalEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;
  private readonly name: string;
  private readonly queryPrefix: string;
  private readonly cacheDir: string | undefined;
  private extractor: Promise<Extractor> | null = null;

  constructor(opts: LocalEmbedderOptions = {}) {
    this.name = opts.model ?? LOCAL_EMBEDDING_MODEL;
    this.dimensions = opts.dimensions ?? 1024;
    this.model = `local:${this.name}@${this.dimensions}`;
    this.queryPrefix =
      opts.queryPrefix ?? (this.name === LOCAL_EMBEDDING_MODEL ? LOCAL_QUERY_PREFIX : "");
    this.cacheDir = opts.cacheDir;
  }

  private load(): Promise<Extractor> {
    this.extractor ??= (async () => {
      let lib: typeof import("@huggingface/transformers");
      try {
        lib = await import("@huggingface/transformers");
      } catch {
        throw new EmbeddingUnavailableError(
          "EMBEDDINGS=local needs the optional package @huggingface/transformers",
        );
      }
      if (this.cacheDir) lib.env.cacheDir = this.cacheDir;
      const pipe = await lib.pipeline("feature-extraction", this.name, { dtype: "q8" });
      return pipe as unknown as Extractor;
    })().catch((err: unknown) => {
      // Let the next call try again, for example once the network is back.
      this.extractor = null;
      throw err instanceof EmbeddingUnavailableError
        ? err
        : new EmbeddingUnavailableError(`Local embeddings failed: ${(err as Error).message}`);
    });
    return this.extractor;
  }

  private async run(texts: string[]): Promise<number[][]> {
    const extract = await this.load();
    const out: number[][] = [];
    // Small batches keep memory flat on laptops.
    for (let i = 0; i < texts.length; i += 8) {
      const batch = texts.slice(i, i + 8).map((t) => t || " ");
      const vectors = (await extract(batch, { pooling: "cls", normalize: true })).tolist();
      for (const v of vectors) {
        if (v.length !== this.dimensions) {
          throw new EmbeddingUnavailableError(
            `${this.name} returns ${v.length} dimensions; the index needs ${this.dimensions}`,
          );
        }
        out.push(v.map((x) => Math.round(x * 1e6) / 1e6));
      }
    }
    return out;
  }

  embed(texts: string[]): Promise<number[][]> {
    return this.run(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [v] = await this.run([this.queryPrefix + text]);
    return v!;
  }
}

export type EmbeddingsMode = "hash" | "local" | "off" | "fail";

export interface EmbedderConfig {
  /** `EMBEDDINGS_LOCAL_MODEL`. */
  localModel?: string;
  /** `EMBEDDINGS_CACHE_DIR`. */
  cacheDir?: string;
}

/** Picks the embedder for `EMBEDDINGS`. `provider` arrives with the AI core (L8). */
export function embedderFor(
  mode: string | undefined,
  config: EmbedderConfig = {},
): Embedder | null {
  switch (mode ?? "hash") {
    case "hash":
      return new HashEmbedder();
    case "local":
      return new LocalEmbedder({
        ...(config.localModel ? { model: config.localModel } : {}),
        ...(config.cacheDir ? { cacheDir: config.cacheDir } : {}),
      });
    case "fail":
      return new FailingEmbedder();
    case "off":
      return null;
    default:
      throw new Error(`EMBEDDINGS=${mode} is not supported yet; use hash, local, off, or fail`);
  }
}
