import Link from "next/link";
import type { NoteCard } from "@lore/db";
import { TrustBadge } from "@/components/TrustBadge";
import { timeAgo } from "@/lib/format";
import { noteHref } from "@/lib/urls";

/** Card view of a collection. */
export function NoteCards({ notes }: { notes: NoteCard[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {notes.map((n) => (
        <li key={n.id}>
          <Link
            href={noteHref(n)}
            className="group flex h-full flex-col rounded-lg border border-line bg-paper p-4 transition-colors hover:border-faint/50 hover:bg-bg"
          >
            <p className="text-[14px] font-medium leading-snug text-ink group-hover:text-accent">
              {n.title}
            </p>
            <p className="mt-1 line-clamp-3 flex-1 text-[13px] leading-snug text-muted">
              {n.description}
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-faint">
              <TrustBadge tier={n.trustTier} compact />
              <span className="truncate">{n.namespace}</span>
              <span className="ml-auto whitespace-nowrap">{timeAgo(n.lastChangedAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
