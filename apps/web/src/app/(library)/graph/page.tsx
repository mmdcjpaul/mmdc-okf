import type { Metadata } from "next";
import { getFeatures } from "@lore/db";
import { GlobalGraph } from "@/components/GlobalGraph";
import { PageHeader } from "@/components/PageHeader";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Graph" };

/** Every note the reader can see and the links between them (LB-10). */
export default async function GraphPage() {
  await requireContext();
  if (!(await getFeatures(db())).graph) hidden();
  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Graph"
        description="Every note you can read, and the links between them. Notes that link to each other sit together."
      />
      <GlobalGraph />
    </div>
  );
}
