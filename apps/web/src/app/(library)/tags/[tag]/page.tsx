import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getTerm, listNotes } from "@lore/db";
import { PageHeader } from "@/components/PageHeader";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural } from "@/lib/format";
import { termHref } from "@/lib/urls";
import { Collection, collectionParams } from "../../Collection";

interface Props {
  params: Promise<{ tag: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `#${decodeURIComponent((await params).tag)}` };
}

export default async function TagPage({ params, searchParams }: Props) {
  const tag = decodeURIComponent((await params).tag);
  const opts = collectionParams(await searchParams);
  const { vault, scope } = await requireContext();
  const [term, all] = await Promise.all([
    getTerm(db(), vault.id, "tag", tag),
    listNotes(db(), scope, { tag, sort: opts.sort, deprecated: true, limit: 2000 }),
  ]);
  if (!term && all.length === 0) hidden();
  const namespaces = [
    ...new Set(all.map((n) => n.namespace).filter((n): n is string => !!n)),
  ].sort();
  const notes = opts.ns ? all.filter((n) => n.namespace === opts.ns) : all;
  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        eyebrow={
          <>
            <Link href="/tags" className="hover:text-ink">
              Tags
            </Link>
            <ChevronRight size={13} aria-hidden />
          </>
        }
        title={<span className="font-mono">#{tag}</span>}
        description={`${term?.description ? term.description + " " : ""}${plural(notes.length, "note")}.`}
      />
      <Collection basePath={termHref("tag", tag)} notes={notes} namespaces={namespaces} {...opts} />
    </div>
  );
}
