/**
 * `@lore/ai`: embeddings today; provider registry, task routing, budgets, and usage logging
 * arrive in L8.
 *
 * @packageDocumentation
 */
export {
  EmbeddingUnavailableError,
  FailingEmbedder,
  HashEmbedder,
  LOCAL_EMBEDDING_MODEL,
  LocalEmbedder,
  embedderFor,
  type Embedder,
  type EmbedderConfig,
  type EmbeddingsMode,
  type LocalEmbedderOptions,
} from "./embeddings.ts";
