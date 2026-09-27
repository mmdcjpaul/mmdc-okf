import type { Metadata } from "next";
import Link from "next/link";
import { countBy, listTerms } from "@lore/db";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { titleCase } from "@/lib/format";
import { termHref } from "@/lib/urls";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsPage() {
  const { vault, scope } = await requireContext();
  const [tags, counts] = await Promise.all([
    listTerms(db(), vault.id, "tag"),
    countBy(db(), scope, "tag"),
  ]);
  const count = new Map(counts.map((c) => [c.key, c.count]));
  const facets = new Map<string, typeof tags>();
  for (const t of tags)
    facets.set(t.facet ?? "other", [...(facets.get(t.facet ?? "other") ?? []), t]);
  const governed = new Set(tags.map((t) => t.slug));
  const ungoverned = counts.filter((c) => !governed.has(c.key));

  return (
    <div className="mx-auto max-w-[960px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Tags"
        description="Governed labels from the vault's tag list, grouped by facet."
      />
      {[...facets].map(([facet, list]) => (
        <Section key={facet} title={titleCase(facet)}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {list.map((t) => (
              <li key={t.slug}>
                <Link
                  href={termHref("tag", t.slug)}
                  className="group flex items-start gap-3 rounded-lg border border-line bg-paper px-4 py-3 hover:bg-bg"
                >
                  <span className="font-mono text-[13px] text-accent">#{t.slug}</span>
                  <span className="min-w-0 flex-1 text-[13px] leading-snug text-muted">
                    {t.description}
                  </span>
                  <span className="text-xs tabular-nums text-faint">{count.get(t.slug) ?? 0}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ))}
      {ungoverned.length ? (
        <Section title="Not in the tag list">
          <div className="flex flex-wrap gap-2">
            {ungoverned.map((c) => (
              <Link
                key={c.key}
                href={termHref("tag", c.key)}
                className="rounded-md bg-warn-soft px-2 py-1 font-mono text-xs text-warn"
              >
                #{c.key} {c.count}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
