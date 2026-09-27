import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@lore/ui";
import { IngestForm } from "@/components/IngestForm";
import { PageHeader } from "@/components/PageHeader";
import { requireContext } from "@/lib/context";
import { ingestFormProps } from "@/lib/ingest-page";

export const metadata: Metadata = { title: "Upload" };

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ ns?: string }>;
}) {
  const ctx = await requireContext();
  const props = await ingestFormProps(ctx);
  const ns = (await searchParams).ns;
  return (
    <div className="mx-auto max-w-[720px] px-5 pb-20 pt-10 md:px-10">
      <PageHeader
        title="Upload a document"
        description="The document is turned into notes: one idea each, linked to what already exists. The original is kept."
        actions={
          <Link href="/uploads" className="text-[13.5px] text-accent hover:underline">
            Earlier uploads
          </Link>
        }
      />
      {props.namespaces.length ? (
        <IngestForm
          kind="upload"
          {...props}
          {...(props.namespaces.some((n) => n.slug === ns) ? { initialNamespace: ns! } : {})}
        />
      ) : (
        <EmptyState title="There is nowhere to upload to yet">
          You cannot read any namespace. Ask an admin for access.
        </EmptyState>
      )}
    </div>
  );
}
