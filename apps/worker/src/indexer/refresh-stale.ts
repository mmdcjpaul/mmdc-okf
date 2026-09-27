/**
 * Health refresh. A note's `stale` flag and health score depend on things the vault does not
 * hold: the clock (a note becomes stale when its `stale_after` date passes, with no commit
 * involved) and feedback (open reports, the helpful rate). This runs after every index job,
 * including runs that find nothing new, and whenever feedback changes. It corrects Postgres
 * and Meilisearch for the notes that need it.
 */
import {
  DEFAULT_HEALTH_WEIGHTS,
  getSetting,
  getVault,
  healthInputs,
  healthScore,
  setHealth,
  type Db,
  type HealthWeights,
} from "@lore/db";
import { indexNames, type Meilisearch } from "@lore/search";
import type { Logger } from "pino";

export interface HealthDeps {
  db: Db;
  meili: Meilisearch;
  log: Logger;
  now?: () => Date;
}

export async function healthWeights(db: Db): Promise<HealthWeights> {
  const stored = await getSetting<Partial<HealthWeights>>(db, "health_weights");
  const out = { ...DEFAULT_HEALTH_WEIGHTS };
  for (const key of Object.keys(out) as (keyof HealthWeights)[]) {
    const v = stored?.[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

/**
 * Recomputes staleness and health for the given notes, plus every note whose `stale` flag
 * has drifted from the clock. Returns the ids of the notes that changed.
 */
export async function refreshHealth(
  deps: HealthDeps,
  vaultId: string,
  noteIds: string[] = [],
): Promise<string[]> {
  const { db, meili, log } = deps;
  const now = deps.now?.() ?? new Date();
  const vault = await getVault(db, vaultId);
  if (!vault) throw new Error(`Unknown vault ${vaultId}`);
  const weights = await healthWeights(db);
  const rows = new Map(
    [
      ...(await healthInputs(db, vaultId, now, "drifted")),
      ...(await healthInputs(db, vaultId, now, [...new Set(noteIds)])),
    ].map((r) => [r.id, r]),
  );
  const updates = [...rows.values()]
    .map((r) => ({
      id: r.id,
      stale: r.stale,
      healthScore: healthScore(r, weights),
      reported: r.seriousReports > 0,
      was: r,
    }))
    // Notes just indexed are written whatever their values: their search documents were
    // built before feedback was taken into account.
    .filter(
      (u) =>
        noteIds.includes(u.id) ||
        u.stale !== u.was.storedStale ||
        u.healthScore !== u.was.healthScore,
    );
  if (updates.length === 0) return [];

  const byId = new Map(updates.map((u) => [u.id, u]));
  const names = indexNames(vault.slug);
  const tasks = [
    await meili.index(names.notes).updateDocuments(
      updates.map((u) => ({
        id: u.id,
        stale: u.stale,
        health: u.healthScore,
        reported: u.reported,
      })),
    ),
  ];
  for (let i = 0; i < updates.length; i += 200) {
    const ids = updates
      .slice(i, i + 200)
      .map((u) => JSON.stringify(u.id))
      .join(", ");
    const chunks = await meili.index(names.chunks).getDocuments<{ id: string; note_id: string }>({
      filter: `note_id IN [${ids}]`,
      fields: ["id", "note_id"],
      limit: 100_000,
    });
    if (chunks.results.length === 0) continue;
    tasks.push(
      await meili.index(names.chunks).updateDocuments(
        chunks.results.map((c) => ({
          id: c.id,
          stale: byId.get(c.note_id)?.stale ?? false,
          reported: byId.get(c.note_id)?.reported ?? false,
        })),
      ),
    );
  }
  const finished = await meili.tasks.waitForTasks(
    tasks.map((t) => t.taskUid),
    { timeout: 300_000 },
  );
  const failed = finished.filter((t) => t.status !== "succeeded");
  if (failed.length)
    throw new Error(`Meilisearch task failed: ${JSON.stringify(failed[0]?.error)}`);

  // Postgres last, so a failed search update is retried on the next run.
  await setHealth(db, vaultId, updates);
  log.debug({ vaultId, notes: updates.length }, "health refreshed");
  return updates.map((u) => u.id);
}
