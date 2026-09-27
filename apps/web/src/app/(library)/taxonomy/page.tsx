import type { Metadata } from "next";
import Link from "next/link";
import { proposedTerms } from "@lore/changesets";
import { countBy, listChangesets, listTerms, type TermRow } from "@lore/db";
import { EmptyState } from "@lore/ui";
import { ActionForm } from "@/components/ActionForm";
import { adminButton, adminInput, adminQuiet } from "@/components/admin-styles";
import { PageHeader } from "@/components/PageHeader";
import { canSeeChangeset } from "@/lib/changesets";
import { requireMaintainer } from "@/lib/context";
import { db } from "@/lib/db";
import { plural, timeAgo } from "@/lib/format";
import { termHref } from "@/lib/urls";
import { decide, merge, rename } from "./actions";

export const metadata: Metadata = { title: "Taxonomy" };

const KINDS = [
  { kind: "theme", title: "Themes", one: "theme" },
  { kind: "system", title: "Systems", one: "system" },
  { kind: "tag", title: "Tags", one: "tag" },
] as const;

/** The vocabulary and the queue of proposed terms, for the people who maintain it (AU-10). */
export default async function TaxonomyPage() {
  const { vault, scope, principal } = await requireMaintainer();
  const [terms, inReview, themes, systems, tags] = await Promise.all([
    listTerms(db(), vault.id),
    listChangesets(db(), { vaultId: vault.id, states: ["in_review"], limit: 200 }),
    countBy(db(), scope, "theme"),
    countBy(db(), scope, "system"),
    countBy(db(), scope, "tag"),
  ]);
  const used = {
    theme: new Map(themes.map((c) => [c.key, c.count])),
    system: new Map(systems.map((c) => [c.key, c.count])),
    tag: new Map(tags.map((c) => [c.key, c.count])),
  };
  const active = (kind: string) => terms.filter((t) => t.kind === kind && t.state === "active");
  const queue = inReview
    .filter((cs) => canSeeChangeset(principal, cs))
    .flatMap((cs) =>
      proposedTerms(cs.intents)
        .filter((t) => !t.acceptedBy)
        .map((term) => ({ cs, term })),
    );

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Taxonomy"
        description="Themes, systems, and tags are chosen from this vocabulary, never invented by typing. A rename or a merge changes every note that uses the term in one commit."
      />

      <section aria-label="Proposed terms" className="mb-12">
        <h2 className="mb-2 text-[17px] font-semibold text-ink">
          Proposed terms{queue.length ? ` (${queue.length})` : ""}
        </h2>
        {queue.length === 0 ? (
          <EmptyState title="No terms are waiting">
            When an upload or a writer needs a term that does not exist, it is listed here and the
            change waits for a decision.
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {queue.map(({ cs, term }) => (
              <li
                key={`${cs.id}:${term.kind}:${term.slug}`}
                aria-label={`${term.kind} ${term.slug}`}
                className="rounded-lg border border-line p-4"
              >
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded bg-line-2 px-1.5 py-0.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                    {term.kind}
                  </span>
                  <span className="font-mono text-[14px] font-semibold text-ink">{term.slug}</span>
                  <span className="text-[13.5px] text-ink-2">{term.description}</span>
                </p>
                <p className="mt-1 text-[13px] text-muted">
                  Proposed {timeAgo(cs.submittedAt ?? cs.createdAt)} in{" "}
                  <Link href={`/changes/${cs.id}`} className="text-accent hover:underline">
                    {cs.title || "a change"}
                  </Link>
                  {term.usedBy.length ? `, for ${term.usedBy.map((t) => `"${t}"`).join(", ")}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
                  <ActionForm action={decide}>
                    <input type="hidden" name="changeset" value={cs.id} />
                    <input type="hidden" name="kind" value={term.kind} />
                    <input type="hidden" name="slug" value={term.slug} />
                    <input type="hidden" name="decision" value="accept" />
                    <button type="submit" className={adminButton}>
                      Accept {term.slug}
                    </button>
                  </ActionForm>
                  <ActionForm action={decide} className="min-w-0">
                    <input type="hidden" name="changeset" value={cs.id} />
                    <input type="hidden" name="kind" value={term.kind} />
                    <input type="hidden" name="slug" value={term.slug} />
                    <input type="hidden" name="decision" value="alias" />
                    <span className="flex flex-wrap items-end gap-2">
                      <label className="text-[13px] font-medium text-ink">
                        Use an existing {term.kind} instead of {term.slug}
                        <select
                          name="into"
                          required
                          defaultValue=""
                          className={`${adminInput} mt-1`}
                        >
                          <option value="" disabled>
                            Choose
                          </option>
                          {active(term.kind).map((t) => (
                            <option key={t.slug} value={t.slug}>
                              {t.title} ({t.slug})
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className={adminQuiet}>
                        Use it
                      </button>
                    </span>
                  </ActionForm>
                  <ActionForm action={decide}>
                    <input type="hidden" name="changeset" value={cs.id} />
                    <input type="hidden" name="kind" value={term.kind} />
                    <input type="hidden" name="slug" value={term.slug} />
                    <input type="hidden" name="decision" value="reject" />
                    <button type="submit" className={adminQuiet}>
                      Reject {term.slug}
                    </button>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {KINDS.map(({ kind, title, one }) => {
        const list = active(kind);
        return (
          <section key={kind} aria-label={title} className="mb-12">
            <h2 className="mb-2 text-[17px] font-semibold text-ink">
              {title} ({list.length})
            </h2>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-[13.5px]">
                <thead className="bg-bg text-[12px] uppercase tracking-wide text-faint">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Term
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Also called
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Notes
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Rename
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-2">
                  {list.map((t) => (
                    <TermRowView key={t.slug} term={t} notes={used[kind].get(t.slug) ?? 0} />
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > 1 ? (
              <details className="mt-3 rounded-lg border border-line p-4">
                <summary className="cursor-pointer text-[13.5px] font-medium text-ink">
                  Merge {title.toLowerCase()}
                </summary>
                <ActionForm
                  action={merge}
                  className="mt-3"
                  confirm={`Merge these ${title.toLowerCase()}? Every note that uses them changes.`}
                >
                  <input type="hidden" name="kind" value={kind} />
                  <fieldset>
                    <legend className="text-[13px] font-medium text-ink">Merge these</legend>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                      {list.map((t) => (
                        <label key={t.slug} className="flex items-center gap-1.5 text-[13.5px]">
                          <input
                            type="checkbox"
                            name="from"
                            value={t.slug}
                            className="size-4 accent-[var(--accent)]"
                          />
                          {t.slug}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="mt-3 block max-w-xs text-[13px] font-medium text-ink">
                    Into this {one}
                    <select name="into" required defaultValue="" className={`${adminInput} mt-1`}>
                      <option value="" disabled>
                        Choose
                      </option>
                      {list.map((t) => (
                        <option key={t.slug}>{t.slug}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={`${adminButton} mt-3`}>
                    Merge {title.toLowerCase()}
                  </button>
                </ActionForm>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function TermRowView({ term, notes }: { term: TermRow; notes: number }) {
  const kind = term.kind as "theme" | "system" | "tag";
  return (
    <tr className="align-top">
      <th scope="row" className="px-3 py-2.5 font-normal">
        <Link href={termHref(kind, term.slug)} className="font-medium text-ink hover:underline">
          {term.title}
        </Link>
        <span className="ml-2 font-mono text-[12.5px] text-muted">{term.slug}</span>
        {term.description ? (
          <span className="mt-0.5 block max-w-md text-[13px] text-muted">{term.description}</span>
        ) : (
          <span className="mt-0.5 block text-[13px] text-warn">No description</span>
        )}
      </th>
      <td className="px-3 py-2.5 font-mono text-[12.5px] text-ink-2">{term.aliases.join(", ")}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
        <span title={plural(notes, "note")}>{notes}</span>
      </td>
      <td className="px-3 py-2.5">
        <ActionForm action={rename} className="flex flex-wrap items-start gap-2">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="from" value={term.slug} />
          <input
            name="to"
            required
            aria-label={`New name for ${term.slug}`}
            placeholder={term.slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            className={`${adminInput} h-8 w-44 font-mono text-[12.5px]`}
          />
          <button type="submit" className={adminQuiet} aria-label={`Rename ${term.slug}`}>
            Rename
          </button>
        </ActionForm>
      </td>
    </tr>
  );
}
