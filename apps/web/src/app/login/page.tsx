import type { Metadata } from "next";
import { connection } from "next/server";
import { listUsers } from "@lore/db";
import { currentUserId, currentVault } from "@/lib/context";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { devSignIn } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // Rendered per request: the person list and dev-login setting are runtime data.
  await connection();
  const devLogin = env().AUTH_DEV_LOGIN === "true";
  const [users, vault, current] = await Promise.all([
    devLogin ? listUsers(db()) : Promise.resolve([]),
    currentVault(),
    currentUserId(),
  ]);
  const people = users.filter((u) => !u.serviceAccount);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span
            aria-hidden
            className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-ink"
          >
            {(vault?.title ?? "L").slice(0, 1).toUpperCase()}
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Sign in to {vault?.title ?? "the Library"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {devLogin
              ? "Development sign-in: choose a person to browse as."
              : "Company sign-in is not configured yet."}
          </p>
        </div>

        {devLogin ? (
          <ul className="overflow-hidden rounded-xl border border-line bg-paper shadow-sm">
            {people.map((u) => (
              <li key={u.id} className="border-b border-line-2 last:border-0">
                <form action={devSignIn}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                    >
                      {u.name
                        .split(" ")
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">
                        {u.name}
                        {current === u.id ? (
                          <span className="ml-2 text-xs font-normal text-faint">current</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted">{u.email}</span>
                    </span>
                    {u.role !== "member" ? (
                      <span className="rounded-full bg-line-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">
                        {u.role}
                      </span>
                    ) : null}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        {devLogin && people.length === 0 ? (
          <p className="text-center text-sm text-muted">
            No people yet. Run <code>pnpm lore seed --principals fixtures/principals.yaml</code>.
          </p>
        ) : null}
      </div>
    </main>
  );
}
