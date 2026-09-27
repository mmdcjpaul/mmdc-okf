import Link from "next/link";
import type { ReactNode } from "react";
import { countBy, listChangesets, listNamespaces, unreadCount } from "@lore/db";
import { CommandPaletteProvider } from "@/components/CommandPaletteProvider";
import { MobileNav } from "@/components/MobileNav";
import { SidebarNav, type SidebarCounts, type SidebarNamespace } from "@/components/SidebarNav";
import { UserMenu } from "@/components/UserMenu";
import { getBranding } from "@/lib/branding";
import { canApproveChangeset } from "@/lib/changesets";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export default async function LibraryLayout({ children }: { children: ReactNode }) {
  const { vault, principal, scope } = await requireContext();
  const [namespaces, counts, branding, inReview, mine, unread] = await Promise.all([
    listNamespaces(db(), vault.id),
    countBy(db(), scope, "namespace"),
    getBranding(vault.title),
    listChangesets(db(), {
      vaultId: vault.id,
      states: ["in_review"],
      namespaces: scope.namespaces,
      limit: 200,
    }),
    listChangesets(db(), {
      vaultId: vault.id,
      submitterId: principal.user.id,
      states: ["draft", "conflicted", "changes_requested"],
      limit: 50,
    }),
    unreadCount(db(), principal.user.id, vault.id),
  ]);
  // Review appears for people who can approve something somewhere: writers and up.
  const approves = principal.isAdmin || [...principal.access.values()].some((l) => l !== "read");
  const sidebarCounts: SidebarCounts = {
    review: approves ? inReview.filter((c) => canApproveChangeset(principal, c)).length : null,
    unread,
    mine: mine.length,
    admin: principal.isAdmin,
  };
  const countOf = new Map(counts.map((c) => [c.key, c.count]));
  const readable = new Set(scope.namespaces);
  const nav: SidebarNamespace[] = namespaces
    .filter((n) => readable.has(n.slug))
    .map((n) => ({
      slug: n.slug,
      title: n.title,
      count: countOf.get(n.slug) ?? 0,
      restricted: n.visibility === "restricted",
    }));

  const brand = (
    <Link
      href="/"
      className="flex min-w-0 items-center gap-2 rounded-md py-1 text-[14px] font-semibold text-ink"
    >
      {branding.logoUrl ? (
        <img src={branding.logoUrl} alt="" width={22} height={22} className="size-[22px] rounded" />
      ) : (
        <span
          aria-hidden
          className="flex size-[22px] items-center justify-center rounded-md bg-accent text-[12px] font-bold text-accent-ink"
        >
          {branding.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate">{branding.name}</span>
    </Link>
  );
  const user = (
    <UserMenu
      name={principal.user.name}
      email={principal.user.email}
      role={principal.user.role}
      devLogin={env().AUTH_DEV_LOGIN === "true"}
    />
  );

  return (
    <CommandPaletteProvider>
      {branding.accent ? <style>{`:root{--accent:${branding.accent}}`}</style> : null}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col border-r border-line bg-bg px-3 pb-3 pt-4 md:flex">
        <div className="mb-4 pl-2">{brand}</div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <SidebarNav namespaces={nav} counts={sidebarCounts} />
        </div>
        <div className="border-t border-line pt-2">{user}</div>
      </aside>
      <MobileNav brand={brand} namespaces={nav} counts={sidebarCounts} footer={user} />
      <main id="main" className="min-h-dvh bg-paper md:ml-[248px]">
        {children}
      </main>
    </CommandPaletteProvider>
  );
}
