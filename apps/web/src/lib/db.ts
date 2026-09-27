import "server-only";
import { createDb, type Db } from "@lore/db";
import { Meilisearch } from "@lore/search";
import { embedderFor, type Embedder } from "@lore/ai";
import { env } from "./env";

const g = globalThis as unknown as { __loreDb?: Db; __loreMeili?: Meilisearch };

/** One pool per server process, kept across dev reloads. */
export function db(): Db {
  g.__loreDb ??= createDb(env().DATABASE_URL, { max: 10 });
  return g.__loreDb;
}

export function meili(): Meilisearch {
  g.__loreMeili ??= new Meilisearch({ host: env().MEILI_URL, apiKey: env().MEILI_SEARCH_KEY });
  return g.__loreMeili;
}

let embedder: Embedder | null | undefined;

export function queryEmbedder(): Embedder | null {
  if (embedder === undefined) embedder = embedderFor(env().EMBEDDINGS);
  return embedder;
}

/** Embeds a search query, or returns null so search falls back to keyword only (LB-6). */
export async function embedQuery(q: string): Promise<number[] | null> {
  const e = queryEmbedder();
  if (!e || !q.trim()) return null;
  try {
    const [v] = await e.embed([q]);
    return v ?? null;
  } catch {
    return null;
  }
}
