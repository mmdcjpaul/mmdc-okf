import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  llmBatches,
  llmBatchRequests,
  noteQuestions,
  type LlmBatchRequestRow,
  type LlmBatchRow,
  type NoteQuestionsRow,
} from "../schema.ts";

export type NewBatchRequest = typeof llmBatchRequests.$inferInsert;

/** Stores a request for the next batch. Asking again with the same key changes nothing. */
export async function enqueueBatchRequest(db: Db, row: NewBatchRequest): Promise<void> {
  await db.insert(llmBatchRequests).values(row).onConflictDoNothing();
}

export async function getBatchRequest(db: Db, key: string): Promise<LlmBatchRequestRow | null> {
  const [row] = await db
    .select()
    .from(llmBatchRequests)
    .where(eq(llmBatchRequests.key, key))
    .limit(1);
  return row ?? null;
}

export async function deleteBatchRequests(db: Db, keys: string[]): Promise<void> {
  if (keys.length) await db.delete(llmBatchRequests).where(inArray(llmBatchRequests.key, keys));
}

/** Drops everything stored for one piece of work, once it is finished or given up. */
export async function clearBatchRequests(db: Db, ownerKind: string, ownerId: string) {
  await db
    .delete(llmBatchRequests)
    .where(and(eq(llmBatchRequests.ownerKind, ownerKind), eq(llmBatchRequests.ownerId, ownerId)));
}

export async function pendingBatchRequests(
  db: Db,
  provider?: string,
  limit = 10_000,
): Promise<LlmBatchRequestRow[]> {
  return db
    .select()
    .from(llmBatchRequests)
    .where(
      and(
        eq(llmBatchRequests.state, "pending"),
        provider ? eq(llmBatchRequests.provider, provider) : undefined,
      ),
    )
    .orderBy(asc(llmBatchRequests.createdAt), asc(llmBatchRequests.key))
    .limit(limit);
}

export async function createBatch(
  db: Db,
  batch: { id: string; provider: string; externalId: string; at: Date },
  keys: string[],
): Promise<LlmBatchRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(llmBatches)
      .values({
        id: batch.id,
        provider: batch.provider,
        externalId: batch.externalId,
        requests: keys.length,
        submittedAt: batch.at,
      })
      .returning();
    await tx
      .update(llmBatchRequests)
      .set({ state: "submitted", batchId: batch.id })
      .where(inArray(llmBatchRequests.key, keys));
    return row!;
  });
}

export async function openBatches(db: Db): Promise<LlmBatchRow[]> {
  return db
    .select()
    .from(llmBatches)
    .where(eq(llmBatches.state, "submitted"))
    .orderBy(asc(llmBatches.submittedAt));
}

export async function lastBatchAt(db: Db, provider: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(${llmBatches.submittedAt})` })
    .from(llmBatches)
    .where(eq(llmBatches.provider, provider));
  return row?.at ? new Date(row.at) : null;
}

export async function touchBatch(db: Db, id: string, at: Date): Promise<void> {
  await db.update(llmBatches).set({ polledAt: at }).where(eq(llmBatches.id, id));
}

export interface BatchAnswer {
  key: string;
  ok: boolean;
  answer?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  error?: string;
}

/**
 * Writes a finished batch's answers. Requests the provider did not answer are marked
 * failed, so the work that waits for them runs at the normal price instead of waiting forever.
 */
export async function finishBatch(
  db: Db,
  id: string,
  result: { state: "ended" | "failed"; error?: string; answers: BatchAnswer[]; at: Date },
): Promise<LlmBatchRequestRow[]> {
  return db.transaction(async (tx) => {
    for (const a of result.answers) {
      await tx
        .update(llmBatchRequests)
        .set({
          state: a.ok ? "done" : "failed",
          answer: a.answer ?? null,
          usage: a.usage ?? null,
          error: a.error ?? null,
          finishedAt: result.at,
        })
        .where(and(eq(llmBatchRequests.key, a.key), eq(llmBatchRequests.batchId, id)));
    }
    await tx
      .update(llmBatchRequests)
      .set({
        state: "failed",
        error: result.error ?? "The provider returned no answer for this request",
        finishedAt: result.at,
      })
      .where(and(eq(llmBatchRequests.batchId, id), eq(llmBatchRequests.state, "submitted")));
    await tx
      .update(llmBatches)
      .set({
        state: result.state,
        error: result.error ?? null,
        endedAt: result.at,
        polledAt: result.at,
      })
      .where(eq(llmBatches.id, id));
    return tx.select().from(llmBatchRequests).where(eq(llmBatchRequests.batchId, id));
  });
}

// doc2query

export async function questionsFor(
  db: Db,
  vaultId: string,
  noteIds: string[],
): Promise<Map<string, NoteQuestionsRow>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(noteQuestions)
    .where(and(eq(noteQuestions.vaultId, vaultId), inArray(noteQuestions.noteId, noteIds)));
  return new Map(rows.map((r) => [r.noteId, r]));
}

export async function allQuestions(
  db: Db,
  vaultId: string,
): Promise<Map<string, NoteQuestionsRow>> {
  const rows = await db.select().from(noteQuestions).where(eq(noteQuestions.vaultId, vaultId));
  return new Map(rows.map((r) => [r.noteId, r]));
}

export async function saveQuestions(
  db: Db,
  row: {
    vaultId: string;
    noteId: string;
    contentHash: string;
    questions: string[];
    model: string;
    at: Date;
  },
): Promise<void> {
  const values = {
    vaultId: row.vaultId,
    noteId: row.noteId,
    contentHash: row.contentHash,
    questions: row.questions,
    model: row.model,
    generatedAt: row.at,
  };
  await db
    .insert(noteQuestions)
    .values(values)
    .onConflictDoUpdate({ target: [noteQuestions.vaultId, noteQuestions.noteId], set: values });
}
