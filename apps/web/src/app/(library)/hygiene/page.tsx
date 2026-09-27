import type { Metadata } from "next";
import Link from "next/link";
import {
  getChangeset,
  getFeatures,
  hygieneByNamespace,
  hygieneCounts,
  hygieneNotes,
  listGardenerRuns,
  listNamespaces,
  type HygieneNote,
  type HygieneProblem,
} from "@lore/db";
import { EmptyState, TrustBadge } from "@lore/ui";
import { GardenerPanel } from "@/components/GardenerPanel";
import { PageHeader } from "@/components/PageHeader";
import { RefreshWhile } from "@/components/RefreshWhile";
import { RunGardener } from "@/components/RunGardener";
import { TypeIcon } from "@/components/TypeIcon";
import { canSeeChangeset } from "@/lib/changesets";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural, shortDate } from "@/lib/format";
import { visibleReport } from "@/lib/gardener";
import { noteHref } from "@/lib/urls";
import { runGardenerNow } from "./actions";

export const metadata: Metadata = { title: "Hygiene" };

interface Props {
  searchParams: Promise<{ problem?: string; ns?: string; mine?: string; page?: string }>;
}

const PAGE = 50;
const PROBLEMS: { value: HygieneProblem; label: string; hint: string }[] = [
  { value: "reported", label: "Reported", hint: "A reader reported an issue" },
  { value: "stale", label: "Review due", hint: "The review date has passed" },
  { value: "unverified", label: "Never verified", hint: "Nobody has checked it is accurate" },
  { value: "flagged", label: "Linked process changed", hint: "It links to a process that changed" },
  { value: "broken", label: "Broken links", hint: "It links to a note that does not exist" },
];

function problemsOf(n: HygieneNote): string[] {
  return [
    n.openReports ? plural(n.openReports, "open report") : null,
    n.stale ? `Review due ${shortDate(n.staleAfter)}` : null,
    n.trustTier === "unverified" ? "Never verified" : null,
    n.flags ? "Linked process changed" : null,
    n.brokenLinks ? plural(n.brokenLinks, "broken link") : null,
  ].filter((p): p is string => p !== null);
}

function tone(score: number): string {
  if (score >= 90) return "bg-ok-soft text-ok";
  if (score >= 70) return "bg-warn-soft text-warn";
  return "bg-bad-soft text-bad";
}

/** Notes sorted by health, worst first, for the people who look after them (LB-11). */
export default async function HygienePage({ searchParams }: Props) {
  const { vault, scope, principal } = await requireContext();
  const sp = await searchParams;
  const problem = PROBLEMS.find((p) => p.value === sp.problem)?.value;
  const namespace = scope.namespaces.includes(sp.ns ?? "") ? sp.ns : undefined;
  const mine = sp.mine === "1" && principal.teamIds.length > 0;
  const page = Math.max(1, Math.min(200, Number(sp.page) || 1));
  const filter = {
    ...(mine ? { ownerTeams: principal.teamIds } : {}),
    ...(namespace ? { namespace } : {}),
  };
  const [counts, byNamespace, notes, namespaces, runs, features] = await Promise.all([
    hygieneCounts(db(), scope, filter),
    hygieneByNamespace(db(), scope),
    hygieneNotes(db(), scope, {
      ...filter,
      ...(problem ? { problem } : { onlyProblems: true }),
      limit: PAGE + 1,
      offset: (page - 1) * PAGE,
    }),
    listNamespaces(db(), vault.id),
    listGardenerRuns(db(), vault.id, { limit: 10 }),
    getFeatures(db()),
  ]);
  // A run for one namespace is shown to the people who can read that namespace.
  const visible = runs.filter((r) => !r.namespace || scope.namespaces.includes(r.namespace));
  const running = visible.find((r) => r.state === "running");
  const last = visible.find((r) => r.state === "done");
  const failed = visible[0]?.state === "failed" ? visible[0] : null;
  const proposals = [];
  for (const id of last?.proposals ?? []) {
    const cs = await getChangeset(db(), id);
    if (cs && canSeeChangeset(principal, cs))
      proposals.push({ id: cs.id, title: cs.title, state: cs.state });
  }
  const mayRun = namespaces.filter(
    (n) => principal.isAdmin || principal.access.get(n.slug) === "maintain",
  );
  const nsTitle = new Map(namespaces.map((n) => [n.slug, n.title]));
  const href = (change: Record<string, string | undefined>) => {
    const next = {
      problem,
      ns: namespace,
      mine: mine ? "1" : undefined,
      page: undefined as string | undefined,
      ...change,
    };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `/hygiene${q.size ? `?${q}` : ""}`;
  };
  const chip = (active: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${
      active
        ? "border-accent bg-accent-soft text-accent"
        : "border-line bg-paper text-ink-2 hover:bg-hover"
    }`;

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Hygiene"
        description={`${plural(counts.needAttention, "note needs", "notes need")} attention out of ${counts.notes.toLocaleString("en")}. Average health ${counts.averageHealth} out of 100.`}
      />

      <section aria-label="Health by namespace" className="mb-8">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">By namespace</h2>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[13.5px]">
            <thead className="bg-bg text-[12px] uppercase tracking-wide text-faint">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Namespace
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Notes
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Need attention
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Average health
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {byNamespace.map((n) => (
                <tr key={n.namespace}>
                  <th scope="row" className="px-3 py-2 font-medium">
                    <Link href={href({ ns: n.namespace })} className="text-ink hover:underline">
                      {nsTitle.get(n.namespace) ?? n.namespace}
                    </Link>
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{n.notes}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    {n.needAttention}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    {n.averageHealth}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {features.gardener ? (
        <section aria-label="Gardener" className="mb-8">
          <h2 className="mb-2 text-[15px] font-semibold text-ink">Gardener</h2>
          <RefreshWhile
            active={
              !!running ||
              proposals.some((p) => ["submitted", "approved", "committing"].includes(p.state))
            }
            everyMs={2000}
          />
          {running ? (
            <p role="status" className="mb-3 text-[13.5px] text-ink-2">
              The Gardener is looking at{" "}
              {running.namespace
                ? (nsTitle.get(running.namespace) ?? running.namespace)
                : "the vault"}
              .
            </p>
          ) : null}
          {failed && !running ? (
            <p className="mb-3 text-[13.5px] text-warn">
              The last run did not finish: {failed.error}
            </p>
          ) : null}
          {last ? (
            <GardenerPanel run={last} view={visibleReport(last, scope)} proposals={proposals} />
          ) : running ? null : (
            <p className="text-[13.5px] text-muted">
              It has not run yet. It runs every week, and proposes fixes for review. It never
              changes a note by itself.
            </p>
          )}
          {mayRun.length ? (
            <RunGardener
              action={runGardenerNow}
              namespaces={mayRun.map((n) => ({ slug: n.slug, title: n.title }))}
              vault={principal.isAdmin}
              selected={namespace && mayRun.some((n) => n.slug === namespace) ? namespace : ""}
              latest={visible[0]?.id ?? null}
              running={!!running}
            />
          ) : null}
        </section>
      ) : null}

      <section aria-label="Notes that need attention">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">
          Notes that need attention
          {namespace ? ` in ${nsTitle.get(namespace) ?? namespace}` : ""}
        </h2>
        <nav aria-label="Filters" className="mb-4 flex flex-wrap gap-2">
          <Link
            href={href({ problem: undefined })}
            className={chip(!problem)}
            aria-current={!problem ? "true" : undefined}
          >
            All <span className="tabular-nums text-muted">{counts.needAttention}</span>
          </Link>
          {PROBLEMS.map((p) => (
            <Link
              key={p.value}
              href={href({ problem: p.value })}
              className={chip(problem === p.value)}
              aria-current={problem === p.value ? "true" : undefined}
              title={p.hint}
            >
              {p.label} <span className="tabular-nums text-muted">{counts[p.value]}</span>
            </Link>
          ))}
          {principal.teamIds.length ? (
            <Link
              href={href({ mine: mine ? undefined : "1" })}
              className={chip(mine)}
              aria-current={mine ? "true" : undefined}
            >
              Owned by my teams
            </Link>
          ) : null}
          {namespace ? (
            <Link href={href({ ns: undefined })} className={chip(false)}>
              Every namespace
            </Link>
          ) : null}
        </nav>

        {notes.length === 0 ? (
          <EmptyState title="Nothing needs attention here">
            Notes appear here when a reader reports them, when their review date passes, or when
            nobody has verified them.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-[13.5px]">
              <thead className="bg-bg text-[12px] uppercase tracking-wide text-faint">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Health
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Note
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    What is wrong
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Owner
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Changed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {notes.slice(0, PAGE).map((n) => (
                  <tr key={n.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex h-6 min-w-9 items-center justify-center rounded-full px-2 text-[12.5px] font-semibold tabular-nums ${tone(n.healthScore)}`}
                      >
                        {n.healthScore}
                      </span>
                    </td>
                    <th scope="row" className="px-3 py-2.5 font-normal">
                      <Link
                        href={noteHref(n)}
                        className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline"
                      >
                        <TypeIcon type={n.type} size={14} />
                        {n.title}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                        {n.namespace ? (nsTitle.get(n.namespace) ?? n.namespace) : null}
                        <TrustBadge tier={n.trustTier} />
                      </span>
                    </th>
                    <td className="px-3 py-2.5 text-ink-2">{problemsOf(n).join(" · ")}</td>
                    <td className="px-3 py-2.5 text-ink-2">{n.ownerTeam ?? "Nobody"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted">
                      {shortDate(n.lastChangedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav aria-label="Pages" className="mt-4 flex justify-between text-[13.5px]">
          {page > 1 ? (
            <Link href={href({ page: String(page - 1) })} className="text-accent hover:underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          {notes.length > PAGE ? (
            <Link href={href({ page: String(page + 1) })} className="text-accent hover:underline">
              Next
            </Link>
          ) : null}
        </nav>
      </section>
    </div>
  );
}
