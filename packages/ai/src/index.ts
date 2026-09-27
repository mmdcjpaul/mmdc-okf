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
  embedderFor,
  type Embedder,
  type EmbeddingsMode,
} from "./embeddings.ts";
