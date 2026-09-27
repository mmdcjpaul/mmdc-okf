import type { Metadata } from "next";
import Link from "next/link";
import { listChangesets, type ChangesetRow } from "@lore/db";
import { EmptyState } from "@lore/ui";
import { StateBadge } from "@/components/ChangesetState";
import { PageHeader } from "@/components/PageHeader";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "My changes" };

/** Everything the person has submitted, newest first, with what needs their attention on top. */
export default async function MyChangesPage() {
  const { vault, principal } = await requireContext();
  const all = await listChangesets(db(), {
    vaultId: vault.id,
    submitterId: principal.user.id,
    limit: 100,
  });
  const needs = all.filter((c) => ["draft", "conflicted", "changes_requested"].includes(c.state));
  const rest = all.filter((c) => !needs.includes(c));

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader title="My changes" description="Edits, suggestions, and uploads you have made." />
      {all.length === 0 ? (
        <EmptyState title="Nothing yet">
          Edit a note or suggest a change and it will be listed here.
        </EmptyState>
      ) : null}
      {needs.length ? <List title="Waiting for you" items={needs} /> : null}
      {rest.length ? (
        <List title={needs.length ? "Everything else" : "Changes"} items={rest} />
      ) : null}
    </div>
  );
}

function List({ title, items }: { title: string; items: ChangesetRow[] }) {
  return (
    <section className="mb-10" aria-label={title}>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">{title}</h2>
      <ul className="divide-y divide-line-2 rounded-lg border border-line">
        {items.map((c) => (
          <li key={c.id}>
            <Link
              href={`/changes/${c.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-bg"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink first-letter:uppercase">
                  {c.title || "A change being processed"}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {c.namespaces.join(", ") || "Vocabulary"} · {timeAgo(c.updatedAt)}
                </span>
              </span>
              <StateBadge state={c.state} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
