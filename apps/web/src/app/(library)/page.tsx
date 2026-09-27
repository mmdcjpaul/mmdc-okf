import Link from "next/link";
import { Pin, Search } from "lucide-react";
import {
  countBy,
  listNamespaces,
  listTerms,
  pinnedHubs,
  processChangesSince,
  recentlyChanged,
} from "@lore/db";
import { EmptyState } from "@/components/EmptyState";
import { NoteList } from "@/components/NoteList";
import { Section } from "@/components/Section";
import { TypeIcon } from "@/components/TypeIcon";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural, timeAgo } from "@/lib/format";
import { folderHref, termHref, typeHref } from "@/lib/urls";

const DAY_MS = 24 * 3600 * 1000;

export default async function HomePage() {
  const { vault, principal, scope } = await requireContext();
  const since = new Date(Date.now() - 30 * DAY_MS);
  const [changes, recent, themes, themeCounts, types, namespaces, nsCounts, systems, pins] =
    await Promise.all([
      processChangesSince(db(), scope, since),
      recentlyChanged(db(), scope, 8),
      listTerms(db(), vault.id, "theme"),
      countBy(db(), scope, "theme"),
      countBy(db(), scope, "type"),
      listNamespaces(db(), vault.id),
      countBy(db(), scope, "namespace"),
      listTerms(db(), vault.id, "system"),
      pinnedHubs(db(), vault.id, principal.teamIds),
    ]);
  const hubOf = new Map([...themes, ...systems].map((t) => [`${t.kind}:${t.slug}`, t] as const));
  const pinned = pins.flatMap((p) => hubOf.get(`${p.kind}:${p.slug}`) ?? []);
  const themeCount = new Map(themeCounts.map((c) => [c.key, c.count]));
  const nsCount = new Map(nsCounts.map((c) => [c.key, c.count]));
  const total = nsCounts.reduce((s, c) => s + c.count, 0);
  const firstName = principal.user.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-[960px] px-5 pb-16 pt-10 md:px-10 md:pt-14">
      <header className="mb-10">
        <p className="text-sm text-muted">
          {vault.title} · {plural(total, "note")} · indexed {timeAgo(vault.lastIndexedAt)}
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Good to see you, {firstName}.
        </h1>
        <form action="/search" role="search" className="mt-6">
          <label htmlFor="home-search" className="sr-only">
            Search the Library
          </label>
          <div className="flex h-12 items-center gap-3 rounded-xl border border-line bg-paper px-4 shadow-sm focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/10">
            <Search size={18} className="text-muted" aria-hidden />
            <input
              id="home-search"
              name="q"
              type="search"
              placeholder="Search runbooks, systems, processes…"
              className="h-full flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
            />
            <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-faint sm:block">
              ⌘K
            </kbd>
          </div>
        </form>
      </header>

      {pinned.length ? (
        <Section title="Pinned by your team">
          <ul className="flex flex-wrap gap-2">
            {pinned.map((t) => (
              <li key={`${t.kind}:${t.slug}`}>
                <Link
                  href={termHref(t.kind as "theme" | "system", t.slug)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-[13.5px] text-ink-2 transition-colors hover:border-faint/50 hover:bg-bg hover:text-ink"
                >
                  <Pin size={13} className="text-muted" aria-hidden />
                  {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {changes.length ? (
        <Section title="Process changes in the last 30 days">
          <NoteList notes={changes} showNamespace showUpdated />
        </Section>
      ) : null}

      <Section
        title="Themes"
        action={
          <Link href="/themes" className="text-[13px] text-accent hover:underline">
            All themes
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((t) => (
            <Link
              key={t.slug}
              href={termHref("theme", t.slug)}
              className="group rounded-lg border border-line bg-paper p-4 transition-colors hover:border-faint/50 hover:bg-bg"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[14px] font-medium text-ink group-hover:text-accent">
                  {t.title}
                </p>
                <span className="text-xs tabular-nums text-faint">
                  {themeCount.get(t.slug) ?? 0}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">
                {t.description}
              </p>
            </Link>
          ))}
        </div>
        {themes.length === 0 ? <EmptyState title="No themes yet" /> : null}
      </Section>

      <div className="grid gap-10 lg:grid-cols-[1fr_280px]">
        <Section title="Recently updated">
          {recent.length ? (
            <NoteList notes={recent} showNamespace showUpdated />
          ) : (
            <EmptyState title="Nothing indexed yet" />
          )}
        </Section>

        <div>
          <Section title="Namespaces">
            <ul className="space-y-1">
              {namespaces
                .filter((n) => scope.namespaces.includes(n.slug))
                .map((n) => (
                  <li key={n.slug}>
                    <Link
                      href={folderHref(n.slug)}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-[13.5px] text-ink-2 hover:bg-hover hover:text-ink"
                    >
                      <span className="truncate">{n.title}</span>
                      <span className="text-xs tabular-nums text-faint">
                        {nsCount.get(n.slug) ?? 0}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </Section>
          <Section title="Types">
            <ul className="space-y-1">
              {types.map((t) => (
                <li key={t.key}>
                  <Link
                    href={typeHref(t.key)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] text-ink-2 hover:bg-hover hover:text-ink"
                  >
                    <TypeIcon type={t.key} size={15} className="text-muted" />
                    <span className="flex-1 truncate">{t.key}</span>
                    <span className="text-xs tabular-nums text-faint">{t.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
