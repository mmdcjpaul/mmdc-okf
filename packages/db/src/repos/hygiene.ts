import { sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import type { TrustTier } from "../schema.ts";
import type { ReadScope } from "./library.ts";

export type HygieneProblem = "stale" | "reported" | "unverified" | "broken" | "flagged";

export interface HygieneNote {
  id: string;
  slug: string;
  title: string;
  type: string;
  namespace: string | null;
  /** The note's owner, or the team that owns its namespace. */
  ownerTeam: string | null;
  stale: boolean;
  staleAfter: Date | null;
  trustTier: TrustTier;
  healthScore: number;
  openReports: number;
  brokenLinks: number;
  /** Notes it links to whose process changed since it was last looked at. */
  flags: number;
  lastChangedAt: Date | null;
}

export interface HygieneQuery {
  /** Only notes these teams own. */
  ownerTeams?: string[];
  namespace?: string;
  problem?: HygieneProblem;
  /** Only notes with at least one problem. */
  onlyProblems?: boolean;
  limit?: number;
  offset?: number;
}

const PROBLEM = {
  stale: sql`x.stale`,
  reported: sql`x.open_reports > 0`,
  unverified: sql`x.trust_tier = 'unverified'`,
  broken: sql`x.broken_links > 0`,
  flagged: sql`x.flags > 0`,
} as const;

function base(scope: ReadScope, q: HygieneQuery) {
  // An empty list would be invalid SQL; a name no namespace has matches nothing.
  const readable = scope.namespaces.length ? scope.namespaces : [""];
  return sql`
    select n.id, n.slug, n.title, n.type, n.namespace, n.stale, n.stale_after, n.trust_tier,
      n.health_score, n.last_changed_at, coalesce(n.owner, ns.owner_team) as owner_team,
      (select count(*)::int from feedback f
        where f.vault_id = n.vault_id and f.note_id = n.id and f.kind = 'report'
          and f.state = 'open') as open_reports,
      (select count(*)::int from note_links l
        where l.vault_id = n.vault_id and l.source_id = n.id and l.wanted) as broken_links,
      (select count(*)::int from note_flags g
        where g.vault_id = n.vault_id and g.note_id = n.id and g.cleared_at is null) as flags
    from notes n
    left join namespaces ns on ns.vault_id = n.vault_id and ns.slug = n.namespace
    where n.vault_id = ${scope.vaultId}
      and n.namespace in ${readable}
      and n.hub_kind is null
      and n.status <> 'deprecated'
      and n.type <> 'Source Document'
      ${q.namespace ? sql`and n.namespace = ${q.namespace}` : sql``}
      ${q.ownerTeams ? sql`and coalesce(n.owner, ns.owner_team) in ${q.ownerTeams.length ? q.ownerTeams : [""]}` : sql``}
  `;
}

function filter(q: HygieneQuery) {
  if (q.problem) return sql`where ${PROBLEM[q.problem]}`;
  if (q.onlyProblems)
    return sql`where (${PROBLEM.stale} or ${PROBLEM.reported} or ${PROBLEM.unverified}
      or ${PROBLEM.broken} or ${PROBLEM.flagged})`;
  return sql``;
}

/** Notes a person can read, worst health first. */
export async function hygieneNotes(
  db: Db,
  scope: ReadScope,
  q: HygieneQuery = {},
): Promise<HygieneNote[]> {
  const rows = await db.execute<{
    id: string;
    slug: string;
    title: string;
    type: string;
    namespace: string | null;
    owner_team: string | null;
    stale: boolean;
    stale_after: string | Date | null;
    trust_tier: TrustTier;
    health_score: number;
    open_reports: number;
    broken_links: number;
    flags: number;
    last_changed_at: string | Date | null;
  }>(sql`
    select * from (${base(scope, q)}) x ${filter(q)}
    order by x.health_score asc, x.open_reports desc, x.title asc, x.id asc
    limit ${Math.min(q.limit ?? 50, 500)} offset ${q.offset ?? 0}
  `);
  const date = (v: string | Date | null) => (v === null ? null : new Date(v));
  return [...rows].map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    type: r.type,
    namespace: r.namespace,
    ownerTeam: r.owner_team,
    stale: r.stale,
    staleAfter: date(r.stale_after),
    trustTier: r.trust_tier,
    healthScore: r.health_score,
    openReports: r.open_reports,
    brokenLinks: r.broken_links,
    flags: r.flags,
    lastChangedAt: date(r.last_changed_at),
  }));
}

export interface HygieneCounts extends Record<HygieneProblem, number> {
  notes: number;
  /** Notes with at least one problem. */
  needAttention: number;
  averageHealth: number;
}

export async function hygieneCounts(
  db: Db,
  scope: ReadScope,
  q: Pick<HygieneQuery, "ownerTeams" | "namespace"> = {},
): Promise<HygieneCounts> {
  const [r] = await db.execute<Record<string, number>>(sql`
    select count(*)::int as notes,
      count(*) filter (where ${PROBLEM.stale})::int as stale,
      count(*) filter (where ${PROBLEM.reported})::int as reported,
      count(*) filter (where ${PROBLEM.unverified})::int as unverified,
      count(*) filter (where ${PROBLEM.broken})::int as broken,
      count(*) filter (where ${PROBLEM.flagged})::int as flagged,
      count(*) filter (where ${PROBLEM.stale} or ${PROBLEM.reported} or ${PROBLEM.unverified}
        or ${PROBLEM.broken} or ${PROBLEM.flagged})::int as need_attention,
      coalesce(round(avg(x.health_score)), 100)::int as average_health
    from (${base(scope, q)}) x
  `);
  return {
    notes: r?.notes ?? 0,
    stale: r?.stale ?? 0,
    reported: r?.reported ?? 0,
    unverified: r?.unverified ?? 0,
    broken: r?.broken ?? 0,
    flagged: r?.flagged ?? 0,
    needAttention: r?.need_attention ?? 0,
    averageHealth: r?.average_health ?? 100,
  };
}

/** Health by namespace, for the dashboard's first table. */
export async function hygieneByNamespace(db: Db, scope: ReadScope) {
  const rows = await db.execute<{
    namespace: string;
    notes: number;
    need_attention: number;
    average_health: number;
  }>(sql`
    select x.namespace, count(*)::int as notes,
      count(*) filter (where ${PROBLEM.stale} or ${PROBLEM.reported} or ${PROBLEM.unverified}
        or ${PROBLEM.broken} or ${PROBLEM.flagged})::int as need_attention,
      round(avg(x.health_score))::int as average_health
    from (${base(scope, {})}) x group by x.namespace order by average_health asc, x.namespace asc
  `);
  return [...rows].map((r) => ({
    namespace: r.namespace,
    notes: r.notes,
    needAttention: r.need_attention,
    averageHealth: r.average_health,
  }));
}
