import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { listNotes } from "@lore/db";
import { PageHeader } from "@/components/PageHeader";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural } from "@/lib/format";
import { typeHref } from "@/lib/urls";
import { Collection, collectionParams } from "../../Collection";

interface Props {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: decodeURIComponent((await params).type) };
}

export default async function TypeCollectionPage({ params, searchParams }: Props) {
  const type = decodeURIComponent((await params).type);
  const opts = collectionParams(await searchParams);
  const { scope } = await requireContext();
  const all = await listNotes(db(), scope, {
    type,
    sort: opts.sort,
    deprecated: true,
    limit: 2000,
  });
  if (all.length === 0) hidden();
  const namespaces = [
    ...new Set(all.map((n) => n.namespace).filter((n): n is string => !!n)),
  ].sort();
  const notes = opts.ns ? all.filter((n) => n.namespace === opts.ns) : all;
  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        eyebrow={
          <>
            <Link href="/types" className="hover:text-ink">
              Types
            </Link>
            <ChevronRight size={13} aria-hidden />
          </>
        }
        title={type}
        description={plural(notes.length, "note")}
      />
      <Collection basePath={typeHref(type)} notes={notes} namespaces={namespaces} {...opts} />
    </div>
  );
}
