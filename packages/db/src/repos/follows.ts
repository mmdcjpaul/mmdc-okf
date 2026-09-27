import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../client.ts";
import { follows, notifications, userPrefs, users } from "../schema.ts";

/** A note id, or a hub written as `theme:<slug>` or `system:<slug>`. */
export function isFollowTarget(target: string): boolean {
  return (
    /^(theme|system):[a-z0-9][a-z0-9-]*$/.test(target) || /^[A-Za-z0-9][\w-]{3,63}$/.test(target)
  );
}

export async function follow(db: Db, userId: string, vaultId: string, target: string) {
  await db.insert(follows).values({ userId, vaultId, target }).onConflictDoNothing();
}

export async function unfollow(db: Db, userId: string, vaultId: string, target: string) {
  await db
    .delete(follows)
    .where(
      and(eq(follows.userId, userId), eq(follows.vaultId, vaultId), eq(follows.target, target)),
    );
}

export async function isFollowing(
  db: Db,
  userId: string,
  vaultId: string,
  target: string,
): Promise<boolean> {
  const rows = await db
    .select({ target: follows.target })
    .from(follows)
    .where(
      and(eq(follows.userId, userId), eq(follows.vaultId, vaultId), eq(follows.target, target)),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listFollows(db: Db, userId: string, vaultId: string) {
  return db
    .select({ target: follows.target, createdAt: follows.createdAt })
    .from(follows)
    .where(and(eq(follows.userId, userId), eq(follows.vaultId, vaultId)))
    .orderBy(asc(follows.createdAt));
}

/** People who follow any of the targets, each once. */
export async function followersOfAny(
  db: Db,
  vaultId: string,
  targets: string[],
): Promise<string[]> {
  if (targets.length === 0) return [];
  const rows = await db
    .selectDistinct({ userId: follows.userId })
    .from(follows)
    .where(and(eq(follows.vaultId, vaultId), inArray(follows.target, targets)));
  return rows.map((r) => r.userId);
}

export interface EmailPrefs {
  emailNotifications: boolean;
  emailDigest: boolean;
  digestSentAt: Date | null;
}

export async function getPrefs(db: Db, userId: string): Promise<EmailPrefs> {
  const [row] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId)).limit(1);
  return {
    emailNotifications: row?.emailNotifications ?? true,
    emailDigest: row?.emailDigest ?? true,
    digestSentAt: row?.digestSentAt ?? null,
  };
}

export async function setPrefs(
  db: Db,
  userId: string,
  patch: Partial<Pick<EmailPrefs, "emailNotifications" | "emailDigest" | "digestSentAt">>,
): Promise<void> {
  await db
    .insert(userPrefs)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: userPrefs.userId, set: patch });
}

export interface PendingEmail {
  id: number;
  userId: string;
  name: string;
  email: string;
  vaultId: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
}

/**
 * Notifications nobody has emailed yet, for people who want email. Read ones are left out:
 * the person has already seen them in the app.
 */
export async function notificationsToEmail(
  db: Db,
  since: Date,
  limit = 200,
): Promise<PendingEmail[]> {
  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      name: users.name,
      email: users.email,
      vaultId: notifications.vaultId,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .leftJoin(userPrefs, eq(userPrefs.userId, notifications.userId))
    .where(
      and(
        isNull(notifications.emailedAt),
        isNull(notifications.readAt),
        gt(notifications.createdAt, since),
        eq(users.serviceAccount, false),
        sql`coalesce(${userPrefs.emailNotifications}, true)`,
      ),
    )
    .orderBy(asc(notifications.id))
    .limit(limit);
}

export async function markEmailed(db: Db, ids: number[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.update(notifications).set({ emailedAt: at }).where(inArray(notifications.id, ids));
}
