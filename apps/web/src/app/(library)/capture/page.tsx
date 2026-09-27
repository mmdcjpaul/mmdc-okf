import type { Metadata } from "next";
import Link from "next/link";
import { getFeatures, getNote } from "@lore/db";
import { EmptyState } from "@lore/ui";
import { IngestForm } from "@/components/IngestForm";
import { PageHeader } from "@/components/PageHeader";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { ingestFormProps } from "@/lib/ingest-page";

export const metadata: Metadata = { title: "Capture" };

export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; ns?: string }>;
}) {
  const ctx = await requireContext();
  if (!(await getFeatures(db())).capture) hidden();
  const query = await searchParams;
  const props = await ingestFormProps(ctx);
  const note = query.note ? await getNote(db(), ctx.scope, query.note) : null;
  if (query.note && (!note || !note.namespace)) hidden();
  return (
    <div className="mx-auto max-w-[720px] px-5 pb-20 pt-10 md:px-10">
      <PageHeader
        title="Capture"
        description="Paste rough notes and screenshots. They are turned into proper notes, or used to update one."
        actions={
          <Link href="/uploads" className="text-[13.5px] text-accent hover:underline">
            Earlier captures
          </Link>
        }
      />
      {props.namespaces.length ? (
        <IngestForm
          kind="capture"
          {...props}
          {...(note
            ? { target: { id: note.id, title: note.title, namespace: note.namespace! } }
            : {})}
          {...(props.namespaces.some((n) => n.slug === query.ns)
            ? { initialNamespace: query.ns! }
            : {})}
        />
      ) : (
        <EmptyState title="There is nowhere to capture to yet">
          You cannot read any namespace. Ask an admin for access.
        </EmptyState>
      )}
    </div>
  );
}
