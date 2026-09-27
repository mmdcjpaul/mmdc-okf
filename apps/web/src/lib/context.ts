import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { loadPrincipal, readScope, type Principal } from "@lore/auth";
import { sessionUserId } from "@lore/auth/sign-in";
import { firstVault, getVaultBySlug, type ReadScope, type Vault } from "@lore/db";
import { auth } from "./auth";
import { db } from "./db";
import { env } from "./env";

export interface RequestContext {
  vault: Vault;
  principal: Principal;
  scope: ReadScope;
}

/** The signed-in person, or null. Cached for the request. */
export const currentUserId = cache(async (): Promise<string | null> => {
  // The headers are asked for first: that is what tells a build that the page is rendered
  // per request, before anything needs the deployment's configuration.
  const sent = await headers();
  return sessionUserId(auth(), sent);
});

export const currentVault = cache(async (): Promise<Vault | null> => {
  const slug = env().LORE_VAULT;
  return slug ? getVaultBySlug(db(), slug) : firstVault(db());
});

/**
 * Vault, principal, and read scope for this request. Redirects to sign-in when there is no
 * session. Every page and route handler that reads notes starts here.
 */
export const requireContext = cache(async (): Promise<RequestContext> => {
  const userId = await currentUserId();
  if (!userId) redirect("/login");
  const vault = await currentVault();
  if (!vault) throw new Error("No vault is registered. Run `pnpm lore seed --vault <dir>`.");
  const principal = await loadPrincipal(db(), vault.id, userId);
  if (!principal) redirect("/login");
  return { vault, principal, scope: readScope(principal) };
});

/** Same as {@link requireContext}, for route handlers: null instead of a redirect. */
export async function apiContext(): Promise<RequestContext | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const vault = await currentVault();
  if (!vault) return null;
  const principal = await loadPrincipal(db(), vault.id, userId);
  return principal ? { vault, principal, scope: readScope(principal) } : null;
}

/** Unreadable and missing notes both 404, so a note's existence is not revealed. */
export function hidden(): never {
  notFound();
}

/**
 * For Admin pages and actions: the request context, for admins and owners only. Anyone else
 * gets 403. Every route under /admin starts here, and a test checks that they do.
 */
export const requireAdmin = cache(async (): Promise<RequestContext> => {
  const ctx = await requireContext();
  if (!ctx.principal.isAdmin) forbidden();
  return ctx;
});

/** True for admins and for people who maintain at least one namespace. */
export function maintainsVocabulary(ctx: RequestContext): boolean {
  return ctx.principal.isAdmin || [...ctx.principal.access.values()].includes("maintain");
}

/** For the Taxonomy screen: the vocabulary belongs to maintainers (PRD 6.4). */
export const requireMaintainer = cache(async (): Promise<RequestContext> => {
  const ctx = await requireContext();
  if (!maintainsVocabulary(ctx)) forbidden();
  return ctx;
});

/** Same as {@link requireAdmin}, for route handlers: a response to return instead of data. */
export async function apiAdmin(): Promise<RequestContext | Response> {
  const ctx = await apiContext();
  if (!ctx) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!ctx.principal.isAdmin) return Response.json({ error: "Admins only" }, { status: 403 });
  return ctx;
}
