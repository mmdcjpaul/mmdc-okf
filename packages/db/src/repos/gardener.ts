import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  gardenerProposals,
  gardenerRuns,
  type GardenerRunRow,
  type StoredGardenerReport,
  type TrustTier,
} from "../schema.ts";

export interface GardenerNote {
  id: string;
  path: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  namespace: string;
  status: string;
  trustTier: TrustTier;
  healthScore: number;
  stale: boolean;
  blobSha: string;
  openReports: number;
  inbound: number;
  lastChangedAt: Date | null;
}

/**
 * The notes the Gardener looks at: content notes in a namespace, not deprecated. It runs as
 * the system, so it sees every namespace; what it found is filtered when it is shown.
 */
export async function gardenerNotes(
  db: Db,
  vaultId: string,
  namespace: string | null,
): Promise<GardenerNote[]> {
  const rows = await db.execute<{
    id: string;
    path: string;
    slug: string;
    title: string;
    description: string;
    type: string;
    namespace: string;
    status: string;
    trust_tier: TrustTier;
    health_score: number;
    stale: boolean;
    blob_sha: string;
    open_reports: number;
    inbound: number;
    last_changed_at: string | Date | null;
  }>(sql`
    select n.id, n.path, n.slug, n.title, n.description, n.type, n.namespace, n.status,
      n.trust_tier, n.health_score, n.stale, n.blob_sha, n.last_changed_at,
      (select count(*)::int from feedback f
        where f.vault_id = n.vault_id and f.note_id = n.id and f.kind = 'report'
          and f.state = 'open') as open_reports,
      (select count(distinct l.source_id)::int from note_links l
        where l.vault_id = n.vault_id and l.target_id = n.id and l.source_id <> n.id) as inbound
    from notes n
    where n.vault_id = ${vaultId}
      and n.namespace is not null
      and n.hub_kind is null
      and n.status <> 'deprecated'
      and n.type not in ('Source Document', 'Graph Report')
      ${namespace ? sql`and n.namespace = ${namespace}` : sql``}
    order by n.path
  `);
  return [...rows].map((r) => ({
    id: r.id,
    path: r.path,
    slug: r.slug,
    title: r.title,
    description: r.description,
    type: r.type,
    namespace: r.namespace,
    status: r.status,
    trustTier: r.trust_tier,
    healthScore: r.health_score,
    stale: r.stale,
    blobSha: r.blob_sha,
    openReports: r.open_reports,
    inbound: r.inbound,
    lastChangedAt: r.last_changed_at === null ? null : new Date(r.last_changed_at),
  }));
}

export async function startGardenerRun(
  db: Db,
  row: {
    id: string;
    vaultId: string;
    namespace: string | null;
    requestedBy: string | null;
    at: Date;
  },
): Promise<GardenerRunRow> {
  const [run] = await db
    .insert(gardenerRuns)
    .values({
      id: row.id,
      vaultId: row.vaultId,
      namespace: row.namespace,
      requestedBy: row.requestedBy,
      startedAt: row.at,
    })
    .returning();
  return run!;
}

export async function finishGardenerRun(
  db: Db,
  id: string,
  result:
    | { state: "done"; report: StoredGardenerReport; proposals: string[]; at: Date }
    | { state: "failed"; error: string; at: Date },
): Promise<GardenerRunRow> {
  const [run] = await db
    .update(gardenerRuns)
    .set(
      result.state === "done"
        ? {
            state: "done",
            report: result.report,
            proposals: result.proposals,
            finishedAt: result.at,
          }
        : { state: "failed", error: result.error, finishedAt: result.at },
    )
    .where(eq(gardenerRuns.id, id))
    .returning();
  return run!;
}

export async function getGardenerRun(db: Db, id: string): Promise<GardenerRunRow | null> {
  const [run] = await db.select().from(gardenerRuns).where(eq(gardenerRuns.id, id)).limit(1);
  return run ?? null;
}

/** The latest runs, newest first. `namespace: null` asks for whole-vault runs only. */
export async function listGardenerRuns(
  db: Db,
  vaultId: string,
  opts: { namespace?: string | null; limit?: number } = {},
): Promise<GardenerRunRow[]> {
  return db
    .select()
    .from(gardenerRuns)
    .where(
      and(
        eq(gardenerRuns.vaultId, vaultId),
        opts.namespace === undefined
          ? undefined
          : opts.namespace === null
            ? isNull(gardenerRuns.namespace)
            : eq(gardenerRuns.namespace, opts.namespace),
      ),
    )
    .orderBy(desc(gardenerRuns.startedAt))
    .limit(opts.limit ?? 10);
}

/** Marks runs that a stopped worker left behind, so the dashboard does not wait on them. */
export async function failStuckGardenerRuns(db: Db, before: Date): Promise<number> {
  const rows = await db
    .update(gardenerRuns)
    .set({
      state: "failed",
      error: "The worker stopped before the run finished",
      finishedAt: sql`now()`,
    })
    .where(and(eq(gardenerRuns.state, "running"), lt(gardenerRuns.startedAt, before)))
    .returning({ id: gardenerRuns.id });
  return rows.length;
}

/** Keys proposed since `since`. A proposal that was turned down is not made again for a while. */
export async function proposedKeys(
  db: Db,
  vaultId: string,
  keys: string[],
  since: Date,
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db
    .select({ key: gardenerProposals.key })
    .from(gardenerProposals)
    .where(
      and(
        eq(gardenerProposals.vaultId, vaultId),
        inArray(gardenerProposals.key, keys),
        gt(gardenerProposals.createdAt, since),
      ),
    );
  return new Set(rows.map((r) => r.key));
}

export async function recordProposal(
  db: Db,
  row: { vaultId: string; key: string; changesetId: string; at: Date },
): Promise<void> {
  await db
    .insert(gardenerProposals)
    .values({ vaultId: row.vaultId, key: row.key, changesetId: row.changesetId, createdAt: row.at })
    .onConflictDoUpdate({
      target: [gardenerProposals.vaultId, gardenerProposals.key],
      set: { changesetId: row.changesetId, createdAt: row.at },
    });
}
