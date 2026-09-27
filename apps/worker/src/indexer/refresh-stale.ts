/**
 * Staleness refresh. A note becomes stale when the clock passes its `stale_after` date, with
 * no commit involved, so the index job cannot notice on its own. This runs after every index
 * job, including runs that find nothing new, and corrects the `stale` flag and health score
 * in Postgres and Meilisearch for the notes that drifted.
 */
import { getVault, setStaleness, staleDrift } from "@lore/db";
import { indexNames } from "@lore/search";
import { healthScore } from "./derive.ts";
import type { IndexDeps } from "./index-vault.ts";

/** Returns the ids of the notes whose staleness changed. */
export async function refreshStale(deps: IndexDeps, vaultId: string): Promise<string[]> {
  const { db, meili, log } = deps;
  const now = deps.now?.() ?? new Date();
  const vault = await getVault(db, vaultId);
  if (!vault) throw new Error(`Unknown vault ${vaultId}`);
  const drift = await staleDrift(db, vaultId, now);
  if (drift.length === 0) return [];

  const updates = drift.map((d) => ({
    id: d.id,
    stale: d.stale,
    healthScore: healthScore({ stale: d.stale, trust: d.trustTier, brokenLinks: d.brokenLinks }),
  }));
  const staleOf = new Map(updates.map((u) => [u.id, u.stale]));
  const names = indexNames(vault.slug);
  const tasks = [
    await meili
      .index(names.notes)
      .updateDocuments(updates.map((u) => ({ id: u.id, stale: u.stale, health: u.healthScore }))),
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
      await meili
        .index(names.chunks)
        .updateDocuments(
          chunks.results.map((c) => ({ id: c.id, stale: staleOf.get(c.note_id) ?? false })),
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
  await setStaleness(db, vaultId, updates);
  log.info({ vaultId, notes: updates.length }, "staleness refreshed");
  return updates.map((u) => u.id);
}
