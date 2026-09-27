/** Changesets, reviews, notifications, and note flags. */
import { and, arrayOverlaps, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  changesets,
  follows,
  noteFlags,
  noteLinks,
  notes,
  notifications,
  reviews,
  teamMembers,
  users,
  type ChangesetRow,
  type ChangesetState,
  type NewChangesetRow,
  type NotificationRow,
  type ReviewRow,
  type User,
} from "../schema.ts";

export async function createChangeset(db: Db, row: NewChangesetRow): Promise<ChangesetRow> {
  const [created] = await db.insert(changesets).values(row).returning();
  return created!;
}

export async function getChangeset(db: Db, id: string): Promise<ChangesetRow | null> {
  const [row] = await db.select().from(changesets).where(eq(changesets.id, id));
  return row ?? null;
}

export type ChangesetPatch = Partial<
  Omit<ChangesetRow, "id" | "vaultId" | "createdAt" | "submitterId">
>;

export async function updateChangeset(
  db: Db,
  id: string,
  patch: ChangesetPatch,
): Promise<ChangesetRow | null> {
  const [row] = await db
    .update(changesets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(changesets.id, id))
    .returning();
  return row ?? null;
}

/**
 * Moves a changeset from one of `from` to `to`, or returns null when it is in another state.
 * Two workers, or a double click, cannot both win.
 */
export async function transitionChangeset(
  db: Db,
  id: string,
  from: ChangesetState[],
  to: ChangesetState,
  patch: ChangesetPatch = {},
): Promise<ChangesetRow | null> {
  const [row] = await db
    .update(changesets)
    .set({ ...patch, state: to, updatedAt: new Date() })
    .where(and(eq(changesets.id, id), inArray(changesets.state, from)))
    .returning();
  return row ?? null;
}

/** Changesets waiting for the worker: newly submitted, approved, or stuck mid-commit. */
export async function changesetsToProcess(db: Db, stuckBefore: Date): Promise<ChangesetRow[]> {
  return db
    .select()
    .from(changesets)
    .where(
      or(
        inArray(changesets.state, ["submitted", "approved"]),
        and(eq(changesets.state, "committing"), lt(changesets.updatedAt, stuckBefore)),
      ),
    )
    .orderBy(asc(changesets.updatedAt))
    .limit(50);
}

export interface ChangesetQuery {
  vaultId: string;
  states?: ChangesetState[];
  submitterId?: string;
  /** Changesets that write to any of these namespaces, or to none (hubs and vocabulary). */
  namespaces?: string[];
  noteId?: string;
  limit?: number;
}

export async function listChangesets(db: Db, q: ChangesetQuery): Promise<ChangesetRow[]> {
  return db
    .select()
    .from(changesets)
    .where(
      and(
        eq(changesets.vaultId, q.vaultId),
        q.states ? inArray(changesets.state, q.states) : undefined,
        q.submitterId ? eq(changesets.submitterId, q.submitterId) : undefined,
        q.noteId ? sql`${changesets.noteIds} @> ARRAY[${q.noteId}]::text[]` : undefined,
        q.namespaces
          ? or(
              q.namespaces.length ? arrayOverlaps(changesets.namespaces, q.namespaces) : undefined,
              sql`cardinality(${changesets.namespaces}) = 0`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(changesets.updatedAt))
    .limit(q.limit ?? 100);
}

export async function addReview(
  db: Db,
  row: Pick<ReviewRow, "changesetId" | "reviewerId" | "decision" | "comment">,
): Promise<ReviewRow> {
  const [created] = await db.insert(reviews).values(row).returning();
  return created!;
}

export async function reviewsOf(
  db: Db,
  changesetId: string,
): Promise<(ReviewRow & { reviewerName: string | null })[]> {
  const rows = await db
    .select({ review: reviews, reviewerName: users.name })
    .from(reviews)
    .leftJoin(users, eq(users.id, reviews.reviewerId))
    .where(eq(reviews.changesetId, changesetId))
    .orderBy(asc(reviews.createdAt));
  return rows.map((r) => ({ ...r.review, reviewerName: r.reviewerName }));
}

// Notifications.

export interface NewNotification {
  userId: string;
  vaultId: string;
  kind: string;
  title: string;
  body?: string;
  href?: string | null;
  /** The same key never notifies the same person twice. */
  dedupeKey?: string | null;
}

/** Inserts notifications, skipping any whose dedupe key the person already has. */
export async function notify(db: Db, items: NewNotification[]): Promise<number> {
  if (items.length === 0) return 0;
  const rows = await db
    .insert(notifications)
    .values(items.map((i) => ({ ...i, body: i.body ?? "" })))
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length;
}

export async function listNotifications(
  db: Db,
  userId: string,
  vaultId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.vaultId, vaultId),
        opts.unreadOnly ? isNull(notifications.readAt) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 50);
}

export async function unreadCount(db: Db, userId: string, vaultId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.vaultId, vaultId),
        isNull(notifications.readAt),
      ),
    );
  return row?.n ?? 0;
}

export async function markNotificationsRead(
  db: Db,
  userId: string,
  ids: number[] | "all",
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids === "all" ? undefined : inArray(notifications.id, ids.length ? ids : [-1]),
      ),
    );
}

/** People who follow a note or hub. */
export async function followersOf(db: Db, vaultId: string, target: string): Promise<string[]> {
  const rows = await db
    .select({ userId: follows.userId })
    .from(follows)
    .where(and(eq(follows.vaultId, vaultId), eq(follows.target, target)));
  return rows.map((r) => r.userId);
}

/**
 * Ids of the people who may read a namespace, so nobody is notified about a note they
 * cannot open. Mirrors `computeAccess` in `@lore/auth`.
 */
export async function readersOf(db: Db, vaultId: string, namespace: string): Promise<Set<string>> {
  const rows = await db.execute<{ id: string }>(sql`
    select u.id from users u
    where u.role in ('admin', 'owner')
      or exists (select 1 from namespaces n
        where n.vault_id = ${vaultId} and n.slug = ${namespace} and n.visibility = 'company')
      or exists (select 1 from namespace_grants g
        where g.vault_id = ${vaultId} and g.namespace = ${namespace}
          and (g.user_id = u.id or g.team_id in
            (select team_id from team_members m where m.user_id = u.id)))
  `);
  return new Set([...rows].map((r) => r.id));
}

/**
 * People who may approve a changeset: those holding `level` on every namespace it writes
 * to, or on any namespace when it only changes hubs and vocabulary. Admins always may.
 * Mirrors `canApprove` in `@lore/changesets`; the submitter is left out by the caller.
 */
export async function approversOf(
  db: Db,
  vaultId: string,
  namespaces: string[],
  level: "write" | "maintain",
): Promise<string[]> {
  const levels = level === "maintain" ? ["maintain"] : ["write", "maintain"];
  const held = sql`
    select g.namespace from namespace_grants g
    where g.vault_id = ${vaultId} and g.level in ${levels}
      and (g.user_id = u.id or g.team_id in
        (select team_id from team_members m where m.user_id = u.id))`;
  const rows = await db.execute<{ id: string }>(
    namespaces.length
      ? sql`
        select u.id from users u
        where u.service_account = false and (
          u.role in ('admin', 'owner')
          or (select count(distinct h.namespace) from (${held}) h
              where h.namespace in ${namespaces}) = ${namespaces.length}
        )`
      : sql`
        select u.id from users u
        where u.service_account = false and (
          u.role in ('admin', 'owner') or exists (${held})
        )`,
  );
  return [...rows].map((r) => r.id);
}

/** People in a team, leaving out service accounts. */
export async function teamPeople(db: Db, teamId: string): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(users.serviceAccount, false)));
  return rows.map((r) => r.user);
}

// Flags on notes that link to a note whose process changed (PRD 7.6).

export interface LinkingNote {
  id: string;
  title: string;
  slug: string;
  type: string;
  namespace: string | null;
  owner: string | null;
}

/** Notes that link to `noteId`, across every namespace: flags are for owners, not readers. */
export async function notesLinkingTo(
  db: Db,
  vaultId: string,
  noteId: string,
): Promise<LinkingNote[]> {
  const rows = await db
    .selectDistinct({
      id: notes.id,
      title: notes.title,
      slug: notes.slug,
      type: notes.type,
      namespace: notes.namespace,
      owner: notes.owner,
    })
    .from(noteLinks)
    .innerJoin(notes, and(eq(notes.vaultId, noteLinks.vaultId), eq(notes.id, noteLinks.sourceId)))
    .where(
      and(
        eq(noteLinks.vaultId, vaultId),
        eq(noteLinks.targetId, noteId),
        sql`${notes.id} <> ${noteId}`,
        isNull(notes.hubKind),
      ),
    );
  // Request Types and Actions also point at notes through path fields.
  const fields = await db
    .select({
      id: notes.id,
      title: notes.title,
      slug: notes.slug,
      type: notes.type,
      namespace: notes.namespace,
      owner: notes.owner,
    })
    .from(notes)
    .where(
      and(
        eq(notes.vaultId, vaultId),
        inArray(notes.type, ["Request Type", "Action"]),
        sql`exists (
          select 1 from notes t
          where t.vault_id = ${vaultId} and t.id = ${noteId}
            and (
              ${notes.frontmatter}->>'self_service' like '%' || t.slug || '.md%'
              or ${notes.frontmatter}->>'runbook' like '%' || t.slug || '.md%'
            )
        )`,
      ),
    );
  const seen = new Set<string>();
  return [...rows, ...fields].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
}

export async function flagNotes(
  db: Db,
  rows: {
    vaultId: string;
    noteId: string;
    causeNoteId: string;
    causeSha: string;
    changedAt: Date;
  }[],
): Promise<void> {
  if (rows.length) await db.insert(noteFlags).values(rows).onConflictDoNothing();
}

export interface OpenFlag {
  noteId: string;
  causeNoteId: string;
  causeTitle: string;
  causeSlug: string;
  changedAt: Date;
}

/** Open flags on a note, newest first. */
export async function openFlags(db: Db, vaultId: string, noteId: string): Promise<OpenFlag[]> {
  return db
    .select({
      noteId: noteFlags.noteId,
      causeNoteId: noteFlags.causeNoteId,
      causeTitle: notes.title,
      causeSlug: notes.slug,
      changedAt: noteFlags.changedAt,
    })
    .from(noteFlags)
    .innerJoin(
      notes,
      and(eq(notes.vaultId, noteFlags.vaultId), eq(notes.id, noteFlags.causeNoteId)),
    )
    .where(
      and(
        eq(noteFlags.vaultId, vaultId),
        eq(noteFlags.noteId, noteId),
        isNull(noteFlags.clearedAt),
      ),
    )
    .orderBy(desc(noteFlags.changedAt));
}

/** Clears a note's flags: its owner looked, or the note itself was changed. */
export async function clearFlags(db: Db, vaultId: string, noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return;
  await db
    .update(noteFlags)
    .set({ clearedAt: new Date() })
    .where(
      and(
        eq(noteFlags.vaultId, vaultId),
        inArray(noteFlags.noteId, noteIds),
        isNull(noteFlags.clearedAt),
      ),
    );
}
