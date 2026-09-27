/**
 * Namespace permissions (PRD section 9). Pure functions over grants so the capability matrix
 * can be tested row by row; `principal.ts` loads the inputs from Postgres.
 */

export type Level = "read" | "write" | "maintain";
export type Role = "member" | "admin" | "owner";

const RANK: Record<Level, number> = { read: 1, write: 2, maintain: 3 };

export interface NamespaceInfo {
  slug: string;
  visibility: "company" | "restricted";
}

export interface GrantInfo {
  namespace: string;
  level: Level;
}

export interface AccessInput {
  role: Role;
  /** Grants to the person and to any team they belong to. */
  grants: GrantInfo[];
  namespaces: NamespaceInfo[];
}

/**
 * The level a person holds on each namespace they can read. Admins and owners hold maintain
 * everywhere. Company namespaces give every member read; grants add to that. Restricted
 * namespaces are readable only through a grant.
 */
export function computeAccess(input: AccessInput): Map<string, Level> {
  const out = new Map<string, Level>();
  const admin = input.role === "admin" || input.role === "owner";
  for (const ns of input.namespaces) {
    if (admin) {
      out.set(ns.slug, "maintain");
      continue;
    }
    let best: Level | null = ns.visibility === "company" ? "read" : null;
    for (const g of input.grants) {
      if (g.namespace !== ns.slug) continue;
      if (!best || RANK[g.level] > RANK[best]) best = g.level;
    }
    if (best) out.set(ns.slug, best);
  }
  return out;
}

export function atLeast(held: Level | undefined, needed: Level): boolean {
  return held !== undefined && RANK[held] >= RANK[needed];
}

/** Only company email domains may sign in. An empty list allows every domain (dev only). */
export function isAllowedDomain(email: string, domains: string[]): boolean {
  if (domains.length === 0) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domains.some((d) => d.toLowerCase() === domain);
}
