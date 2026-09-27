import type { Metadata } from "next";
import { countBy, listTerms } from "@lore/db";
import { PageHeader } from "@/components/PageHeader";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { TermIndex } from "../TermIndex";

export const metadata: Metadata = { title: "Themes" };

export default async function ThemesPage() {
  const { vault, scope } = await requireContext();
  const [terms, counts] = await Promise.all([
    listTerms(db(), vault.id, "theme"),
    countBy(db(), scope, "theme"),
  ]);
  return (
    <div className="mx-auto max-w-[960px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Themes"
        description="Cross-cutting subjects that group notes across namespaces."
      />
      <TermIndex kind="theme" terms={terms} counts={new Map(counts.map((c) => [c.key, c.count]))} />
    </div>
  );
}
