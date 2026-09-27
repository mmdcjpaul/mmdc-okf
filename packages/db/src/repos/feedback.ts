/** Feedback on notes (PRD 7.7) and the health score it feeds. */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { feedback, notes, users, type FeedbackRow } from "../schema.ts";

export type ReportReason = NonNullable<FeedbackRow["reason"]>;

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "outdated", label: "Outdated" },
  { value: "incorrect", label: "Incorrect" },
  { value: "unclear", label: "Unclear" },
  { value: "missing", label: "Missing information" },
  { value: "duplicate", label: "Duplicate of another note" },
  { value: "other", label: "Something else" },
];

/** Reports a person may file in 24 hours. */
export const REPORTS_PER_DAY = 10;

export class FeedbackLimitError extends Error {
  readonly status = 429;
  constructor() {
    super(`You can report up to ${REPORTS_PER_DAY} issues a day. Try again tomorrow.`);
    this.name = "FeedbackLimitError";
  }
}

export interface HealthWeights {
  /** Per open report that says the note is incorrect or outdated. */
  seriousReport: number;
  /** Per other open report. */
  otherReport: number;
  stale: number;
  unverified: number;
  brokenLink: number;
  /** The most a good helpful rate can add back. */
  helpfulBonus: number;
  /** Ratings needed before the helpful rate counts. */
  minRatings: number;
}

/** The starting formula from plans/02-library.md, L7. Tunable in settings. */
export const DEFAULT_HEALTH_WEIGHTS: HealthWeights = {
  seriousReport: 25,
  otherReport: 10,
  stale: 20,
  unverified: 10,
  brokenLink: 5,
  helpfulBonus: 10,
  minRatings: 3,
};

export interface HealthInput {
  stale: boolean;
  trust: string;
  brokenLinks: number;
  /** Open reports that say the note is incorrect or outdated. */
  seriousReports?: number;
  otherReports?: number;
  helpful?: number;
  /** Every report ever filed, open or closed: the other side of the helpful rate. */
  reports?: number;
}

/**
 * A note's health, 0 to 100: 100, minus penalties for open reports, staleness, no
 * verification, and broken links, plus a bonus for a good helpful rate.
 */
export function healthScore(input: HealthInput, w: HealthWeights = DEFAULT_HEALTH_WEIGHTS): number {
  let score = 100;
  score -= w.seriousReport * (input.seriousReports ?? 0);
  score -= w.otherReport * (input.otherReports ?? 0);
  if (input.stale) score -= w.stale;
  if (input.trust === "unverified") score -= w.unverified;
  score -= w.brokenLink * input.brokenLinks;
  const helpful = input.helpful ?? 0;
  const ratings = helpful + (input.reports ?? 0);
  if (ratings >= w.minRatings) score += Math.round((w.helpfulBonus * helpful) / ratings);
  return Math.max(0, Math.min(100, score));
}

export interface RecordFeedbackInput {
  vaultId: string;
  noteId: string;
  userId: string;
  kind: "helpful" | "report";
  reason?: ReportReason;
  comment?: string | null;
  /** The note page, or a rating on a Desk answer that cited the note. */
  origin?: "library" | "desk";
  id: string;
  now?: Date;
}

/**
 * Records that a note helped, or reports a problem with it. The Library and the Desk both
 * call this, so a rating on a Desk answer counts toward the notes that answer cited.
 *
 * A person's Helpful counts once per note. Reports are limited to ten a day per person.
 * The caller has checked that the person may read the note.
 */
export async function recordFeedback(db: Db, input: RecordFeedbackInput): Promise<FeedbackRow> {
  const now = input.now ?? new Date();
  if (input.kind === "helpful") {
    const [existing] = await db
      .select()
      .from(feedback)
      .where(
        and(
          eq(feedback.vaultId, input.vaultId),
          eq(feedback.noteId, input.noteId),
          eq(feedback.userId, input.userId),
          eq(feedback.kind, "helpful"),
        ),
      );
    if (existing) return existing;
  } else {
    if (!input.reason) throw new Error("A report needs a reason");
    const since = new Date(now.getTime() - 24 * 3600 * 1000);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(feedback)
      .where(
        and(
          eq(feedback.userId, input.userId),
          eq(feedback.kind, "report"),
          gte(feedback.createdAt, since),
        ),
      );
    if ((row?.n ?? 0) >= REPORTS_PER_DAY) throw new FeedbackLimitError();
  }
  const [created] = await db
    .insert(feedback)
    .values({
      id: input.id,
      vaultId: input.vaultId,
      noteId: input.noteId,
      userId: input.userId,
      kind: input.kind,
      reason: input.kind === "report" ? input.reason! : null,
      comment: input.comment?.trim() || null,
      origin: input.origin ?? "library",
      // A Helpful is a fact, not a task: nothing about it stays open.
      state: input.kind === "report" ? "open" : "resolved",
      createdAt: now,
    })
    .returning();
  return created!;
}

/** Takes back a Helpful. */
export async function removeHelpful(
  db: Db,
  vaultId: string,
  noteId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(feedback)
    .where(
      and(
        eq(feedback.vaultId, vaultId),
        eq(feedback.noteId, noteId),
        eq(feedback.userId, userId),
        eq(feedback.kind, "helpful"),
      ),
    );
}

export interface NoteFeedback {
  helpful: number;
  /** Whether this person marked the note helpful. */
  mine: boolean;
  /** Open reports, newest first. */
  open: (FeedbackRow & { reporterName: string | null })[];
}

export async function feedbackFor(
  db: Db,
  vaultId: string,
  noteId: string,
  userId: string,
): Promise<NoteFeedback> {
  const rows = await db
    .select({ row: feedback, reporterName: users.name })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .where(and(eq(feedback.vaultId, vaultId), eq(feedback.noteId, noteId)))
    // Ids are ULIDs, so they settle the order of reports filed in the same instant.
    .orderBy(desc(feedback.createdAt), desc(feedback.id));
  const helpful = rows.filter((r) => r.row.kind === "helpful");
  return {
    helpful: helpful.length,
    mine: helpful.some((r) => r.row.userId === userId),
    open: rows
      .filter((r) => r.row.kind === "report" && r.row.state === "open")
      .map((r) => ({ ...r.row, reporterName: r.reporterName })),
  };
}

export async function getFeedback(db: Db, id: string): Promise<FeedbackRow | null> {
  const [row] = await db.select().from(feedback).where(eq(feedback.id, id));
  return row ?? null;
}

/** An owner closes a report without changing the note, and says why. */
export async function dismissReport(
  db: Db,
  id: string,
  userId: string,
  reason: string,
  now: Date = new Date(),
): Promise<FeedbackRow | null> {
  const [row] = await db
    .update(feedback)
    .set({ state: "dismissed", resolution: reason, resolvedBy: userId, closedAt: now })
    .where(and(eq(feedback.id, id), eq(feedback.kind, "report"), eq(feedback.state, "open")))
    .returning();
  return row ?? null;
}

/**
 * Closes the reports a commit resolves (its `Resolves-Report` trailers). Returns the ids of
 * the notes whose reports closed, so their health can be recomputed.
 */
export async function resolveReports(
  db: Db,
  vaultId: string,
  ids: string[],
  sha: string,
  now: Date = new Date(),
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(feedback)
    .set({ state: "resolved", resolution: sha, closedAt: now })
    .where(
      and(
        eq(feedback.vaultId, vaultId),
        inArray(feedback.id, ids),
        eq(feedback.kind, "report"),
        eq(feedback.state, "open"),
      ),
    )
    .returning({ noteId: feedback.noteId });
  return [...new Set(rows.map((r) => r.noteId))];
}

export interface HealthRow extends Required<HealthInput> {
  id: string;
  healthScore: number;
  storedStale: boolean;
}

/**
 * What a note's health is computed from, for the given notes or for every note whose stored
 * `stale` flag no longer matches the clock.
 */
export async function healthInputs(
  db: Db,
  vaultId: string,
  now: Date,
  noteIds: string[] | "drifted",
): Promise<HealthRow[]> {
  if (noteIds !== "drifted" && noteIds.length === 0) return [];
  const at = now.toISOString();
  const isStale = sql`(n.stale_after is not null and n.stale_after <= ${at}::timestamptz)`;
  const which = noteIds === "drifted" ? sql`n.stale <> ${isStale}` : sql`n.id in ${noteIds}`;
  const rows = await db.execute<{
    id: string;
    stale: boolean;
    stored_stale: boolean;
    trust_tier: string;
    health_score: number;
    broken_links: number;
    serious: number;
    other: number;
    helpful: number;
    reports: number;
  }>(sql`
    select n.id, ${isStale} as stale, n.stale as stored_stale, n.trust_tier, n.health_score,
      (select count(*)::int from note_links l
        where l.vault_id = n.vault_id and l.source_id = n.id and l.wanted) as broken_links,
      coalesce(f.serious, 0) as serious, coalesce(f.other, 0) as other,
      coalesce(f.helpful, 0) as helpful, coalesce(f.reports, 0) as reports
    from notes n
    left join (
      select note_id,
        count(*) filter (where kind = 'report' and state = 'open'
          and reason in ('incorrect', 'outdated'))::int as serious,
        count(*) filter (where kind = 'report' and state = 'open'
          and reason not in ('incorrect', 'outdated'))::int as other,
        count(*) filter (where kind = 'helpful')::int as helpful,
        count(*) filter (where kind = 'report')::int as reports
      from feedback where vault_id = ${vaultId} group by note_id
    ) f on f.note_id = n.id
    where n.vault_id = ${vaultId} and ${which}
    order by n.id
  `);
  return [...rows].map((r) => ({
    id: r.id,
    stale: r.stale,
    storedStale: r.stored_stale,
    trust: r.trust_tier,
    healthScore: r.health_score,
    brokenLinks: r.broken_links,
    seriousReports: r.serious,
    otherReports: r.other,
    helpful: r.helpful,
    reports: r.reports,
  }));
}

/** Open reports on notes in the given namespaces, for the people who own them. */
export async function openReports(
  db: Db,
  vaultId: string,
  namespaces: string[],
  limit = 100,
): Promise<(FeedbackRow & { noteTitle: string; noteSlug: string; namespace: string | null })[]> {
  if (namespaces.length === 0) return [];
  const rows = await db
    .select({
      row: feedback,
      noteTitle: notes.title,
      noteSlug: notes.slug,
      namespace: notes.namespace,
    })
    .from(feedback)
    .innerJoin(notes, and(eq(notes.vaultId, feedback.vaultId), eq(notes.id, feedback.noteId)))
    .where(
      and(
        eq(feedback.vaultId, vaultId),
        eq(feedback.kind, "report"),
        eq(feedback.state, "open"),
        inArray(notes.namespace, namespaces),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r.row,
    noteTitle: r.noteTitle,
    noteSlug: r.noteSlug,
    namespace: r.namespace,
  }));
}
