import type { Metadata } from "next";
import Link from "next/link";
import { getUser, listChangesets } from "@lore/db";
import { EmptyState } from "@lore/ui";
import { PageHeader } from "@/components/PageHeader";
import { canApproveChangeset } from "@/lib/changesets";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural, timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Review" };

const SOURCE: Record<string, string> = {
  editor: "Edit",
  suggest: "Suggestion",
  upload: "Upload",
  capture: "Capture",
  gardener: "Gardener",
  agent: "Agent",
};
const DAY = 24 * 3600 * 1000;

/** Working days between two dates, counting Monday to Friday. */
function workingDays(from: Date, to: Date): number {
  let n = 0;
  for (let t = from.getTime() + DAY; t <= to.getTime(); t += DAY) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

/** Changesets waiting for a decision the person is allowed to make, grouped by namespace. */
export default async function ReviewPage() {
  const { vault, principal, scope } = await requireContext();
  const waiting = (
    await listChangesets(db(), {
      vaultId: vault.id,
      states: ["in_review"],
      namespaces: scope.namespaces,
      limit: 200,
    })
  ).filter((c) => canApproveChangeset(principal, c));
  const names = new Map<string, string>();
  for (const id of new Set(waiting.map((c) => c.submitterId).filter((i): i is string => !!i)))
    names.set(id, (await getUser(db(), id))?.name ?? "Someone");

  const groups = new Map<string, typeof waiting>();
  for (const c of waiting) {
    const key = c.namespaces.join(", ") || "Vocabulary";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const now = new Date();

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Review"
        description={
          waiting.length
            ? `${plural(waiting.length, "change")} waiting for you.`
            : "Changes that need a decision from you appear here."
        }
      />
      {waiting.length === 0 ? (
        <EmptyState title="Nothing to review">
          Suggestions, uploads, and changes that need a second pair of eyes will be listed here.
        </EmptyState>
      ) : null}
      {[...groups].sort().map(([ns, items]) => (
        <section key={ns} className="mb-10" aria-label={ns}>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
            {ns}
          </h2>
          <ul className="divide-y divide-line-2 rounded-lg border border-line">
            {items.map((c) => {
              const late = workingDays(c.updatedAt, now) > 5;
              return (
                <li key={c.id}>
                  <Link href={`/changes/${c.id}`} className="block px-4 py-3 hover:bg-bg">
                    <span className="block text-[14px] font-medium text-ink first-letter:uppercase">
                      {c.title}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-muted">
                      {SOURCE[c.source]} by {names.get(c.submitterId ?? "") ?? "Lore"} ·{" "}
                      {timeAgo(c.updatedAt)}
                      {c.approverLevel === "maintain" ? " · Needs a maintainer" : ""}
                      {late ? (
                        <span className="ml-1.5 font-medium text-warn">
                          Waiting more than 5 working days
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[12.5px] text-ink-2">
                      {c.reviewReasons.map((r) => r.message).join(". ")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
