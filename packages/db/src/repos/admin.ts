/** What the Admin screens read and write: people, teams, grants, and the audit log. */
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  auditLog,
  namespaceGrants,
  namespaces,
  teamMembers,
  teams,
  users,
  type Grant,
  type NamespaceRow,
  type User,
} from "../schema.ts";

export interface TeamWithMembers {
  id: string;
  title: string;
  members: { id: string; name: string; email: string }[];
}

export async function listTeams(db: Db): Promise<TeamWithMembers[]> {
  const [all, members] = await Promise.all([
    db.select().from(teams).orderBy(asc(teams.title)),
    db
      .select({ teamId: teamMembers.teamId, id: users.id, name: users.name, email: users.email })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .orderBy(asc(users.name)),
  ]);
  return all.map((t) => ({
    id: t.id,
    title: t.title,
    members: members.filter((m) => m.teamId === t.id).map(({ teamId: _t, ...m }) => m),
  }));
}

export async function createTeam(db: Db, id: string, title: string): Promise<boolean> {
  const rows = await db.insert(teams).values({ id, title }).onConflictDoNothing().returning();
  return rows.length > 0;
}

export async function renameTeam(db: Db, id: string, title: string): Promise<void> {
  await db.update(teams).set({ title }).where(eq(teams.id, id));
}

/** Deletes a team, its memberships, and its grants. */
export async function deleteTeam(db: Db, id: string): Promise<void> {
  await db.delete(teams).where(eq(teams.id, id));
}

export async function setTeamMember(
  db: Db,
  teamId: string,
  userId: string,
  member: boolean,
): Promise<void> {
  if (member) await db.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing();
  else
    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
}

export interface UserWithTeams extends User {
  teams: string[];
}

export async function listUsersWithTeams(db: Db): Promise<UserWithTeams[]> {
  const [all, members] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(teamMembers),
  ]);
  return all.map((u) => ({
    ...u,
    teams: members.filter((m) => m.userId === u.id).map((m) => m.teamId),
  }));
}

export async function setUserRole(db: Db, userId: string, role: User["role"]): Promise<void> {
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

/** People who can manage the deployment. There must always be at least one. */
export async function countAdmins(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(inArray(users.role, ["admin", "owner"]), eq(users.serviceAccount, false)));
  return row?.n ?? 0;
}

export interface GrantWithNames extends Grant {
  teamTitle: string | null;
  userName: string | null;
}

export async function listGrants(db: Db, vaultId: string): Promise<GrantWithNames[]> {
  const rows = await db
    .select({ grant: namespaceGrants, teamTitle: teams.title, userName: users.name })
    .from(namespaceGrants)
    .leftJoin(teams, eq(teams.id, namespaceGrants.teamId))
    .leftJoin(users, eq(users.id, namespaceGrants.userId))
    .where(eq(namespaceGrants.vaultId, vaultId))
    .orderBy(asc(namespaceGrants.namespace), asc(namespaceGrants.id));
  return rows.map((r) => ({ ...r.grant, teamTitle: r.teamTitle, userName: r.userName }));
}

/**
 * Gives a team or a person a level on a namespace, replacing any level they had there, so
 * there is one grant per namespace and holder.
 */
export async function setGrant(
  db: Db,
  input: {
    vaultId: string;
    namespace: string;
    teamId?: string;
    userId?: string;
    level: Grant["level"];
  },
): Promise<void> {
  if (!input.teamId === !input.userId) throw new Error("A grant is for a team or a person");
  await db.transaction(async (tx) => {
    await tx
      .delete(namespaceGrants)
      .where(
        and(
          eq(namespaceGrants.vaultId, input.vaultId),
          eq(namespaceGrants.namespace, input.namespace),
          input.teamId
            ? eq(namespaceGrants.teamId, input.teamId)
            : eq(namespaceGrants.userId, input.userId!),
        ),
      );
    await tx.insert(namespaceGrants).values({
      vaultId: input.vaultId,
      namespace: input.namespace,
      teamId: input.teamId ?? null,
      userId: input.userId ?? null,
      level: input.level,
    });
  });
}

export async function removeGrant(db: Db, vaultId: string, id: number): Promise<Grant | null> {
  const [row] = await db
    .delete(namespaceGrants)
    .where(and(eq(namespaceGrants.vaultId, vaultId), eq(namespaceGrants.id, id)))
    .returning();
  return row ?? null;
}

/**
 * Applies a namespace's settings to Postgres at once. The vault is the source of truth and
 * the indexer writes the same values when the commit lands; this makes a change that
 * restricts a namespace take effect on the next request rather than seconds later.
 */
export async function applyNamespaceSettings(
  db: Db,
  vaultId: string,
  slug: string,
  patch: Partial<Pick<NamespaceRow, "visibility" | "publishing" | "aiProcessing" | "ownerTeam">>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(namespaces)
    .set(patch)
    .where(and(eq(namespaces.vaultId, vaultId), eq(namespaces.slug, slug)));
}

export interface AuditQuery {
  action?: string;
  actorId?: string;
  /** Text in the action, the target, or the actor's name. */
  q?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditEntry {
  id: number;
  at: Date;
  actorId: string | null;
  actorName: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
}

export async function listAudit(db: Db, q: AuditQuery = {}): Promise<AuditEntry[]> {
  const like = q.q ? `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  return db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      actorId: auditLog.actorId,
      actorName: users.name,
      action: auditLog.action,
      target: auditLog.target,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(
      and(
        q.action ? eq(auditLog.action, q.action) : undefined,
        q.actorId ? eq(auditLog.actorId, q.actorId) : undefined,
        q.from ? gte(auditLog.at, q.from) : undefined,
        q.to ? lte(auditLog.at, q.to) : undefined,
        like
          ? or(ilike(auditLog.action, like), ilike(auditLog.target, like), ilike(users.name, like))
          : undefined,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(Math.min(q.limit ?? 100, 1000))
    .offset(q.offset ?? 0);
}

export async function auditActions(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .orderBy(asc(auditLog.action));
  return rows.map((r) => r.action);
}

/** Removes entries older than the retention period (one year, PRD section 9). */
export async function pruneAudit(db: Db, before: Date): Promise<number> {
  const rows = await db.delete(auditLog).where(lte(auditLog.at, before)).returning({
    id: auditLog.id,
  });
  return rows.length;
}
