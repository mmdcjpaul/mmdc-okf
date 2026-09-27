/** Model usage, AI settings, and ingestion items. */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { ingestItems, llmUsage, settings, type IngestItemRow } from "../schema.ts";

export type NewUsageRow = typeof llmUsage.$inferInsert;

export async function recordUsage(db: Db, row: NewUsageRow): Promise<void> {
  await db.insert(llmUsage).values(row);
}

/** Dollars spent on models since `since`, optionally by one task or one person. */
export async function spentSince(
  db: Db,
  since: Date,
  filter: { task?: string; userId?: string } = {},
): Promise<number> {
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)::float8` })
    .from(llmUsage)
    .where(
      and(
        gte(llmUsage.at, since),
        filter.task ? eq(llmUsage.task, filter.task) : undefined,
        filter.userId ? eq(llmUsage.userId, filter.userId) : undefined,
      ),
    );
  return row?.usd ?? 0;
}

export interface UsageByTask {
  task: string;
  model: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
}

/** Usage since `since`, grouped by task and model, for the cost view in Admin. */
export async function usageByTask(db: Db, since: Date): Promise<UsageByTask[]> {
  const rows = await db
    .select({
      task: llmUsage.task,
      model: sql<string>`${llmUsage.provider} || ':' || ${llmUsage.model}`,
      calls: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where not ${llmUsage.ok})::int`,
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`,
      cachedTokens: sql<number>`coalesce(sum(${llmUsage.cachedTokens}), 0)::int`,
      costUsd: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)::float8`,
    })
    .from(llmUsage)
    .where(gte(llmUsage.at, since))
    .groupBy(llmUsage.task, llmUsage.provider, llmUsage.model)
    .orderBy(sql`8 desc`);
  return rows;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

// Ingestion items: one per upload or capture.

export type NewIngestItem = typeof ingestItems.$inferInsert;

export async function createIngestItem(db: Db, row: NewIngestItem): Promise<IngestItemRow> {
  const [created] = await db.insert(ingestItems).values(row).returning();
  return created!;
}

export async function getIngestItem(db: Db, id: string): Promise<IngestItemRow | null> {
  const [row] = await db.select().from(ingestItems).where(eq(ingestItems.id, id));
  return row ?? null;
}

export async function updateIngestItem(
  db: Db,
  id: string,
  patch: Partial<Omit<IngestItemRow, "id" | "vaultId" | "createdAt">>,
): Promise<IngestItemRow | null> {
  const [row] = await db
    .update(ingestItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ingestItems.id, id))
    .returning();
  return row ?? null;
}

/**
 * Claims an item for processing, or returns null when another worker has it or it is done.
 */
export async function claimIngestItem(
  db: Db,
  id: string,
  from: IngestItemRow["state"][],
  to: IngestItemRow["state"],
): Promise<IngestItemRow | null> {
  const [row] = await db
    .update(ingestItems)
    .set({ state: to, stateReason: null, updatedAt: new Date() })
    .where(and(eq(ingestItems.id, id), inArray(ingestItems.state, from)))
    .returning();
  return row ?? null;
}

/** An earlier item in the vault with the same file, if there is one. */
export async function ingestItemByHash(
  db: Db,
  vaultId: string,
  fileHash: string,
): Promise<IngestItemRow | null> {
  const [row] = await db
    .select()
    .from(ingestItems)
    .where(and(eq(ingestItems.vaultId, vaultId), eq(ingestItems.fileHash, fileHash)))
    .orderBy(ingestItems.createdAt)
    .limit(1);
  return row ?? null;
}

export async function listIngestItems(
  db: Db,
  q: { vaultId: string; submitterId?: string; states?: IngestItemRow["state"][]; limit?: number },
): Promise<IngestItemRow[]> {
  return db
    .select()
    .from(ingestItems)
    .where(
      and(
        eq(ingestItems.vaultId, q.vaultId),
        q.submitterId ? eq(ingestItems.submitterId, q.submitterId) : undefined,
        q.states ? inArray(ingestItems.state, q.states) : undefined,
      ),
    )
    .orderBy(desc(ingestItems.createdAt))
    .limit(q.limit ?? 100);
}
