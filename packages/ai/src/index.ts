/**
 * `@lore/ai`: every model call in Lore. A gateway that picks the model for a task from
 * settings, checks budgets before spending, falls back when the primary fails, and logs one
 * usage row per call; provider keys encrypted at rest; and the embedders.
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
export { AiSdkModelProvider, type ModelFactory } from "./ai-sdk.ts";
export { decryptSecret, encryptSecret, maskSecret, parseEncryptionKey } from "./crypto.ts";
export { AiUnavailableError, BudgetExceededError, InvalidOutputError } from "./errors.ts";
export { FakeModelProvider, type RecordedCall, type Script, type ScriptFor } from "./fake.ts";
export { loadScripts, scriptedProvider, type ScriptFile } from "./scripts.ts";
export {
  ModelGateway,
  type AiMode,
  type GatewayDeps,
  type Generated,
  type GenerateInput,
  type UsageRecord,
  type UsageStore,
} from "./gateway.ts";
export {
  costOf,
  DEFAULT_PRICES,
  priceKey,
  type Cost,
  type ModelPrice,
  type TokenUsage,
} from "./prices.ts";
export { asData, type ModelProvider, type ModelRequest, type ModelResponse } from "./provider.ts";
export {
  AiSettings,
  Budgets,
  DEFAULT_TASKS,
  ModelRef,
  PROVIDERS,
  splitModelRef,
  taskConfig,
  TaskConfig,
  TASKS,
  type ProviderId,
  type Task,
} from "./tasks.ts";
