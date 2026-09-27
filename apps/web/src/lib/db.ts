import "server-only";
import { createDb, type Db } from "@lore/db";
import { Meilisearch } from "@lore/search";
import { embedderFor, type Embedder } from "@lore/ai";
import { S3ObjectStore, type ObjectStore } from "@lore/ingest";
import { env } from "./env";

const g = globalThis as unknown as {
  __loreDb?: Db;
  __loreMeili?: Meilisearch;
  __loreObjects?: ObjectStore;
};

/** One pool per server process, kept across dev reloads. */
export function db(): Db {
  g.__loreDb ??= createDb(env().DATABASE_URL, { max: 10 });
  return g.__loreDb;
}

export function meili(): Meilisearch {
  g.__loreMeili ??= new Meilisearch({ host: env().MEILI_URL, apiKey: env().MEILI_SEARCH_KEY });
  return g.__loreMeili;
}

/** Signs URLs only. The web app never reads or writes object bytes. */
export function objects(): ObjectStore {
  g.__loreObjects ??= new S3ObjectStore({
    endpoint: env().S3_ENDPOINT,
    region: env().S3_REGION,
    bucket: env().S3_BUCKET,
    accessKeyId: env().S3_ACCESS_KEY_ID,
    secretAccessKey: env().S3_SECRET_ACCESS_KEY,
  });
  return g.__loreObjects;
}

let embedder: Embedder | null | undefined;

export function queryEmbedder(): Embedder | null {
  if (embedder === undefined) {
    embedder = embedderFor(env().EMBEDDINGS, {
      localModel: env().EMBEDDINGS_LOCAL_MODEL,
      cacheDir: env().EMBEDDINGS_CACHE_DIR,
    });
  }
  return embedder;
}

/** Embeds a search query, or returns null so search falls back to keyword only (LB-6). */
export async function embedQuery(q: string): Promise<number[] | null> {
  const e = queryEmbedder();
  if (!e || !q.trim()) return null;
  try {
    if (e.embedQuery) return await e.embedQuery(q);
    const [v] = await e.embed([q]);
    return v ?? null;
  } catch {
    return null;
  }
}
