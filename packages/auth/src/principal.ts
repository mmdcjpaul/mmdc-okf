import {
  getUser,
  grantsFor,
  listNamespaces,
  teamIdsOf,
  type Db,
  type ReadScope,
  type User,
} from "@lore/db";
import { atLeast, computeAccess, type Level } from "./permissions.ts";

/** Who is asking, and what they may do in one vault. Build once per request. */
export interface Principal {
  user: User;
  vaultId: string;
  teamIds: string[];
  access: Map<string, Level>;
  isAdmin: boolean;
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function loadPrincipal(
  db: Db,
  vaultId: string,
  userId: string,
): Promise<Principal | null> {
  const user = await getUser(db, userId);
  if (!user) return null;
  const teamIds = await teamIdsOf(db, userId);
  const [grants, namespaces] = await Promise.all([
    grantsFor(db, vaultId, userId, teamIds),
    listNamespaces(db, vaultId),
  ]);
  const access = computeAccess({
    role: user.role,
    grants: grants.map((g) => ({ namespace: g.namespace, level: g.level })),
    namespaces,
  });
  return { user, vaultId, teamIds, access, isAdmin: user.role !== "member" };
}

/** Company namespaces plus restricted ones granted to the person or their teams. Admins get all. */
export function readableNamespaces(p: Principal): string[] {
  return [...p.access.keys()].sort();
}

/** The filter every read path uses. */
export function readScope(p: Principal): ReadScope {
  return { vaultId: p.vaultId, namespaces: readableNamespaces(p) };
}

/** Throws a 403 unless the person holds at least `level` on the namespace. */
export function requireNamespace(p: Principal, namespace: string, level: Level): void {
  if (!atLeast(p.access.get(namespace), level)) {
    throw new ForbiddenError(`Needs ${level} on ${namespace}`);
  }
}

export function canOn(p: Principal, namespace: string | null, level: Level): boolean {
  if (namespace === null) return level === "read" || p.isAdmin;
  return atLeast(p.access.get(namespace), level);
}
