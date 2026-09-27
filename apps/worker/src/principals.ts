import { readFileSync } from "node:fs";
import type { PrincipalSeed } from "@lore/db";
import { parse as parseYaml } from "yaml";

/** Reads a principals file (users, teams, grants), such as `fixtures/principals.yaml`. */
export function loadPrincipals(file: string): PrincipalSeed {
  const y = parseYaml(readFileSync(file, "utf8")) as {
    teams?: Record<string, { title: string }>;
    users?: Record<
      string,
      { name: string; email: string; role?: string; teams?: string[]; service_account?: boolean }
    >;
    grants?: {
      namespace: string;
      team?: string;
      user?: string;
      level: "read" | "write" | "maintain";
    }[];
  };
  return {
    teams: Object.entries(y.teams ?? {}).map(([id, t]) => ({ id, title: t.title })),
    users: Object.entries(y.users ?? {}).map(([id, u]) => ({
      id,
      name: u.name,
      email: u.email,
      role: (u.role ?? "member") as "member" | "admin" | "owner",
      serviceAccount: u.service_account ?? false,
      teams: u.teams ?? [],
    })),
    grants: (y.grants ?? []).map((g) => ({
      namespace: g.namespace,
      level: g.level,
      ...(g.team ? { teamId: g.team } : {}),
      ...(g.user ? { userId: g.user } : {}),
    })),
  };
}
