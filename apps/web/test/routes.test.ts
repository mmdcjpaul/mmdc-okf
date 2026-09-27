/**
 * Route inventory (plans/02-library.md, risks): every page and route handler must resolve the
 * caller's read scope before it reads anything. A new route that skips the guard fails here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const APP = join(SRC, "app");

/** Routes that serve signed-out people. Keep this list short and reviewed. */
const PUBLIC = new Set([
  "login/page.tsx",
  "api/auth/[...all]/route.ts",
  "api/health/route.ts",
  // Checked by GitHub's signature, in the worker. It reads nothing from the vault.
  "api/webhooks/github/route.ts",
]);
/** Routes under these folders must also pass the admin guard. */
const ADMIN_PREFIXES = ["(library)/admin/", "api/admin/"];

const READ_GUARD = /\b(requireContext|apiContext|requireAdmin|apiAdmin|requireMaintainer)\(/;
const ADMIN_GUARD = /\b(requireAdmin|apiAdmin)\(/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    try {
      readFileSync(base + ext);
      return base + ext;
    } catch {
      // try the next extension
    }
  }
  return null;
}

/** True when the file, or a module it imports from the app folder, calls a guard. */
function guarded(file: string, guard: RegExp): boolean {
  const text = readFileSync(file, "utf8");
  if (guard.test(text)) return true;
  for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
    const target = resolveImport(file, m[1]!);
    if (!target || !target.startsWith(APP)) continue;
    if (guard.test(readFileSync(target, "utf8"))) return true;
  }
  return false;
}

const routes = walk(APP)
  .filter((f) => /\/(page\.tsx|route\.ts)$/.test(f))
  .map((f) => relative(APP, f))
  .sort();

describe("route inventory", () => {
  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThan(10);
    expect(routes).toContain("api/search/route.ts");
  });

  it.each(routes.filter((r) => !PUBLIC.has(r)))("%s resolves the read scope", (route) => {
    expect(guarded(join(APP, route), READ_GUARD)).toBe(true);
  });

  it.each(routes.filter((r) => ADMIN_PREFIXES.some((p) => r.startsWith(p))))(
    "%s passes the admin guard",
    (route) => {
      expect(guarded(join(APP, route), ADMIN_GUARD)).toBe(true);
    },
  );

  it("every public route exists or is reserved", () => {
    // A stale allow-list entry would let a future route with that name skip the guard unnoticed.
    const reserved = new Set(["api/auth/[...all]/route.ts", "api/health/route.ts"]);
    for (const p of PUBLIC) expect(routes.includes(p) || reserved.has(p), p).toBe(true);
  });

  it("server actions outside sign-in resolve the read scope", () => {
    const actions = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /^\s*["']use server["']/m.test(readFileSync(f, "utf8")))
      .filter((f) => !relative(APP, f).startsWith("login/"));
    for (const f of actions) expect(guarded(f, READ_GUARD), relative(SRC, f)).toBe(true);
  });
});
