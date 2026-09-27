import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../client.ts";
import {
  auditLog,
  namespaceGrants,
  settings,
  teamMembers,
  teams,
  users,
  type Grant,
  type User,
} from "../schema.ts";

export async function listUsers(db: Db): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.name));
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function teamIdsOf(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return rows.map((r) => r.teamId);
}

/** Grants that apply to a person directly or through any of their teams. */
export async function grantsFor(
  db: Db,
  vaultId: string,
  userId: string,
  teamIds: string[],
): Promise<Grant[]> {
  const who = teamIds.length
    ? or(eq(namespaceGrants.userId, userId), inArray(namespaceGrants.teamId, teamIds))
    : eq(namespaceGrants.userId, userId);
  return db
    .select()
    .from(namespaceGrants)
    .where(and(eq(namespaceGrants.vaultId, vaultId), who));
}

export interface PrincipalSeed {
  users: {
    id: string;
    name: string;
    email: string;
    role: User["role"];
    serviceAccount: boolean;
    teams: string[];
  }[];
  teams: { id: string; title: string }[];
  grants: { namespace: string; teamId?: string; userId?: string; level: Grant["level"] }[];
  /** Hubs each team pins to its members' Home page, keyed by team id. */
  pins?: Record<string, PinnedHub[]>;
}

export interface PinnedHub {
  kind: "theme" | "system";
  slug: string;
}

const pinsKey = (vaultId: string) => `pinned_hubs:${vaultId}`;

/** Hubs pinned by the given teams, in team order, without repeats. */
export async function pinnedHubs(db: Db, vaultId: string, teamIds: string[]): Promise<PinnedHub[]> {
  if (teamIds.length === 0) return [];
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, pinsKey(vaultId)));
  const byTeam = (row?.value ?? {}) as Record<string, PinnedHub[]>;
  const seen = new Set<string>();
  const out: PinnedHub[] = [];
  for (const team of [...teamIds].sort()) {
    for (const pin of byTeam[team] ?? []) {
      const key = `${pin.kind}:${pin.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(pin);
    }
  }
  return out;
}

export async function setPinnedHubs(
  db: Db,
  vaultId: string,
  byTeam: Record<string, PinnedHub[]>,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key: pinsKey(vaultId), value: byTeam })
    .onConflictDoUpdate({ target: settings.key, set: { value: byTeam, updatedAt: new Date() } });
}

/** Replaces users, teams, and one vault's grants. Used by `lore seed`. */
export async function seedPrincipals(db: Db, vaultId: string, seed: PrincipalSeed): Promise<void> {
  await db.transaction(async (tx) => {
    for (const t of seed.teams) {
      await tx
        .insert(teams)
        .values(t)
        .onConflictDoUpdate({ target: teams.id, set: { title: t.title } });
    }
    for (const u of seed.users) {
      const row = {
        id: u.id,
        handle: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        serviceAccount: u.serviceAccount,
      };
      await tx.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: row });
      await tx.delete(teamMembers).where(eq(teamMembers.userId, u.id));
      if (u.teams.length) {
        await tx.insert(teamMembers).values(u.teams.map((teamId) => ({ teamId, userId: u.id })));
      }
    }
    await tx.delete(namespaceGrants).where(eq(namespaceGrants.vaultId, vaultId));
    if (seed.grants.length) {
      await tx.insert(namespaceGrants).values(
        seed.grants.map((g) => ({
          vaultId,
          namespace: g.namespace,
          teamId: g.teamId ?? null,
          userId: g.userId ?? null,
          level: g.level,
        })),
      );
    }
  });
  if (seed.pins) await setPinnedHubs(db, vaultId, seed.pins);
}

export async function writeAudit(
  db: Db,
  entry: {
    actorId: string | null;
    action: string;
    target?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target ?? null,
    metadata: entry.metadata ?? {},
  });
}
