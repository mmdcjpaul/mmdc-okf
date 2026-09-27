import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  atLeast,
  computeAccess,
  isAllowedDomain,
  assertDevLoginAllowed,
  type GrantInfo,
  type Level,
  type Role,
} from "../src/index.ts";

const root = new URL("../../../fixtures/", import.meta.url);
const principals = parse(readFileSync(new URL("principals.yaml", root), "utf8"));
const nsYaml = parse(readFileSync(new URL("vault-acme/.kb/namespaces.yaml", root), "utf8"));
const namespaces = Object.entries(nsYaml).map(([slug, v]) => ({
  slug,
  visibility: ((v as { visibility?: string }).visibility ?? "company") as "company" | "restricted",
}));
const restricted = namespaces.filter((n) => n.visibility === "restricted").map((n) => n.slug);
const company = namespaces.filter((n) => n.visibility === "company").map((n) => n.slug);

function accessOf(handle: string): Map<string, Level> {
  const u = principals.users[handle];
  const grants: GrantInfo[] = principals.grants
    .filter(
      (g: { user?: string; team?: string }) =>
        g.user === handle || (g.team && u.teams.includes(g.team)),
    )
    .map((g: { namespace: string; level: Level }) => ({ namespace: g.namespace, level: g.level }));
  return computeAccess({ role: u.role as Role, grants, namespaces });
}

describe("capability matrix (PRD section 9)", () => {
  for (const [handle, exp] of Object.entries(principals.expectations) as [
    string,
    Record<string, unknown>,
  ][]) {
    describe(handle, () => {
      const access = accessOf(handle);

      it("reads every company namespace", () => {
        for (const ns of company) expect(atLeast(access.get(ns), "read")).toBe(true);
      });

      it("reads exactly the expected restricted namespaces", () => {
        const readable = restricted.filter((ns) => atLeast(access.get(ns), "read"));
        expect(readable.sort()).toEqual([...((exp.can_read_restricted as string[]) ?? [])].sort());
      });

      if (exp.admin) {
        it("holds maintain everywhere", () => {
          for (const ns of namespaces) expect(access.get(ns.slug)).toBe("maintain");
        });
      } else {
        it("writes only where granted", () => {
          const expected = new Set([
            ...((exp.can_write as string[]) ?? []),
            ...((exp.can_maintain as string[]) ?? []),
          ]);
          for (const ns of namespaces) {
            expect(atLeast(access.get(ns.slug), "write"), `${handle} write ${ns.slug}`).toBe(
              expected.has(ns.slug),
            );
          }
        });

        it("maintains only where granted", () => {
          const expected = new Set((exp.can_maintain as string[]) ?? []);
          for (const ns of namespaces) {
            expect(atLeast(access.get(ns.slug), "maintain")).toBe(expected.has(ns.slug));
          }
        });
      }
    });
  }

  it("a grant on a company namespace never lowers access", () => {
    const access = computeAccess({
      role: "member",
      grants: [{ namespace: "admissions", level: "read" }],
      namespaces,
    });
    expect(access.get("admissions")).toBe("read");
  });
});

describe("allowed domains", () => {
  it("accepts only listed domains, case-insensitively", () => {
    expect(isAllowedDomain("alice@ACME.test", ["acme.test"])).toBe(true);
    expect(isAllowedDomain("mallory@evil.test", ["acme.test"])).toBe(false);
    expect(isAllowedDomain("not-an-email", ["acme.test"])).toBe(false);
  });
});

describe("dev login", () => {
  it("refuses dev login in production", () => {
    expect(() =>
      assertDevLoginAllowed({ NODE_ENV: "production", AUTH_DEV_LOGIN: "true" }),
    ).toThrow();
    expect(() =>
      assertDevLoginAllowed({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" }),
    ).not.toThrow();
  });
});
