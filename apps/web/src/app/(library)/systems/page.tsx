import type { Metadata } from "next";
import { countBy, listTerms } from "@lore/db";
import { PageHeader } from "@/components/PageHeader";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { TermIndex } from "../TermIndex";

export const metadata: Metadata = { title: "Systems" };

export default async function SystemsPage() {
  const { vault, scope } = await requireContext();
  const [terms, counts] = await Promise.all([
    listTerms(db(), vault.id, "system"),
    countBy(db(), scope, "system"),
  ]);
  return (
    <div className="mx-auto max-w-[960px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Systems"
        description="The software and services the company runs, and the notes about each."
      />
      <TermIndex
        kind="system"
        terms={terms}
        counts={new Map(counts.map((c) => [c.key, c.count]))}
      />
    </div>
  );
}
