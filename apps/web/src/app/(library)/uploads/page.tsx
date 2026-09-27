import type { Metadata } from "next";
import Link from "next/link";
import { getUser, listIngestItems, type IngestItemRow } from "@lore/db";
import { EmptyState } from "@lore/ui";
import { PageHeader } from "@/components/PageHeader";
import { publishes } from "@/lib/changesets";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Uploads" };

const STATE: Record<IngestItemRow["state"], { label: string; tone: string }> = {
  queued: { label: "In the queue", tone: "bg-line-2 text-muted" },
  extracting: { label: "Processing", tone: "bg-info-soft text-info" },
  atomizing: { label: "Processing", tone: "bg-info-soft text-info" },
  waiting: { label: "Waiting", tone: "bg-warn-soft text-warn" },
  done: { label: "Done", tone: "bg-ok-soft text-ok" },
  failed: { label: "Not processed", tone: "bg-bad-soft text-bad" },
};

/** The person's uploads and captures, and for writers, the queue of their namespaces. */
export default async function UploadsPage() {
  const ctx = await requireContext();
  const me = ctx.principal.user.id;
  const all = await listIngestItems(db(), { vaultId: ctx.vault.id, limit: 200 });
  const mine = all.filter((i) => i.submitterId === me);
  const queue = all.filter(
    (i) =>
      i.submitterId !== me &&
      ["queued", "waiting"].includes(i.state) &&
      publishes(ctx.principal, i.namespace),
  );
  const names = new Map<string, string>();
  for (const id of new Set(queue.map((i) => i.submitterId).filter((i): i is string => !!i)))
    names.set(id, (await getUser(db(), id))?.name ?? "Someone");

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Uploads and captures"
        actions={
          <>
            <Link href="/upload" className="text-[13.5px] text-accent hover:underline">
              Upload
            </Link>
            <Link href="/capture" className="text-[13.5px] text-accent hover:underline">
              Capture
            </Link>
          </>
        }
      />
      {queue.length ? (
        <List
          title="Waiting for a writer"
          items={queue}
          by={(i) => names.get(i.submitterId ?? "") ?? "Someone"}
        />
      ) : null}
      {mine.length ? <List title="Yours" items={mine} /> : null}
      {mine.length + queue.length === 0 ? (
        <EmptyState title="Nothing yet">
          Upload a document or capture rough notes, and they will be listed here.
        </EmptyState>
      ) : null}
    </div>
  );
}

function List(props: {
  title: string;
  items: IngestItemRow[];
  by?: (item: IngestItemRow) => string;
}) {
  return (
    <section className="mb-10" aria-label={props.title}>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
        {props.title}
      </h2>
      <ul className="divide-y divide-line-2 rounded-lg border border-line">
        {props.items.map((i) => (
          <li key={i.id}>
            <Link
              href={`/uploads/${i.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-bg"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">
                  {i.fileName ?? "A capture"}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {i.namespace}
                  {props.by ? ` · ${props.by(i)}` : ""} · {timeAgo(i.createdAt)}
                </span>
              </span>
              <span
                className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11.5px] font-medium ${STATE[i.state].tone}`}
              >
                {STATE[i.state].label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
