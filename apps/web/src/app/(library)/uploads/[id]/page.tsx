import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getChangeset, getIngestItem, getUser } from "@lore/db";
import { Banner } from "@lore/ui";
import { IngestStatus } from "@/components/IngestStatus";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { canProcessItem, canSeeItem } from "@/lib/ingest";

export const metadata: Metadata = { title: "Upload" };

export default async function UploadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const item = await getIngestItem(db(), (await params).id);
  if (!item || !canSeeItem(ctx, item)) hidden();
  const [cs, earlier, submitter] = await Promise.all([
    item.changesetId ? getChangeset(db(), item.changesetId) : null,
    item.duplicateOf ? getIngestItem(db(), item.duplicateOf) : null,
    item.submitterId ? getUser(db(), item.submitterId) : null,
  ]);

  return (
    <div className="mx-auto max-w-[760px] px-5 pb-20 pt-8 md:px-10">
      <Link
        href="/uploads"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden />
        Uploads and captures
      </Link>
      <header className="mb-6 mt-3">
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          {item.fileName ?? "A capture"}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-muted">
          {submitter?.name ?? "Someone"} · {item.namespace}
          {item.fileSize ? ` · ${Math.max(1, Math.round(item.fileSize / 1024))} KB` : ""} ·{" "}
          {timeAgo(item.createdAt)}
        </p>
      </header>
      {earlier && canSeeItem(ctx, earlier) ? (
        <div className="mb-5">
          <Banner kind="stale" title="This file was uploaded before">
            The same file was uploaded {timeAgo(earlier.createdAt)}.{" "}
            <Link href={`/uploads/${earlier.id}`} className="font-medium underline">
              See that upload
            </Link>{" "}
            before processing this one again.
          </Banner>
        </div>
      ) : null}
      <div className="rounded-lg border border-line bg-bg p-4">
        <IngestStatus
          id={item.id}
          initial={{
            state: item.state,
            reason: item.stateReason,
            changesetId: item.changesetId,
            changesetState: cs?.state ?? null,
          }}
          canProcess={canProcessItem(ctx, item)}
        />
      </div>
      {item.extractedText ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-[13.5px] font-medium text-ink-2">
            The text that was read from it
          </summary>
          <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-line p-4 font-mono text-[12.5px] leading-relaxed text-ink-2">
            {item.extractedText}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
