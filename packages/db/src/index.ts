/**
 * `@lore/db`: the Library's Postgres schema and the only code that writes SQL.
 *
 * @packageDocumentation
 */
export * from "./schema.ts";
export { closeDb, createDb, type Db, type DbOptions } from "./client.ts";
export * from "./repos/identity.ts";
export * from "./repos/library.ts";
export * from "./repos/indexing.ts";
export * from "./repos/changesets.ts";
export * from "./repos/feedback.ts";
export * from "./repos/ai.ts";
export * from "./repos/admin.ts";
export * from "./repos/follows.ts";
export * from "./repos/hygiene.ts";
export * from "./repos/gardener.ts";
export * from "./repos/batches.ts";
export { NO_GAPS, type GapSource, type KnowledgeGap } from "./gaps.ts";
