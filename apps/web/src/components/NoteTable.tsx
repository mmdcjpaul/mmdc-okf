import Link from "next/link";
import type { NoteCard } from "@lore/db";
import { shortDate } from "@/lib/format";
import { noteHref } from "@/lib/urls";
import { TrustBadge } from "@lore/ui";

interface NoteTableProps {
  notes: NoteCard[];
}

/** Collection table view: one row per note with its metadata. */
export function NoteTable({ notes }: NoteTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-paper">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="border-b border-line bg-bg text-xs text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Title
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Namespace
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Trust
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Version
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Health
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Updated
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-2">
          {notes.map((n) => (
            <tr key={n.id} className="hover:bg-bg">
              <td className="max-w-[380px] px-4 py-2.5">
                <Link
                  href={noteHref(n)}
                  className="block truncate font-medium text-ink hover:text-accent"
                >
                  {n.title}
                </Link>
                {n.description ? (
                  <p className="truncate text-xs text-muted">{n.description}</p>
                ) : null}
              </td>
              <td className="px-3 py-2.5 text-ink-2">{n.namespace ?? "—"}</td>
              <td className="px-3 py-2.5">
                <TrustBadge tier={n.trustTier} />
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-muted">{n.version ?? "—"}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{n.healthScore}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                {shortDate(n.lastChangedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
