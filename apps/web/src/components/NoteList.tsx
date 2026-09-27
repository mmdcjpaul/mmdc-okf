import Link from "next/link";
import type { NoteCard } from "@lore/db";
import { timeAgo } from "@/lib/format";
import { noteHref } from "@/lib/urls";
import { TrustBadge } from "./TrustBadge";
import { TypeIcon } from "./TypeIcon";

interface NoteListProps {
  notes: NoteCard[];
  /** Show the namespace next to each note. */
  showNamespace?: boolean;
  showUpdated?: boolean;
}

/** A compact list of notes: icon, title, description, and trust. */
export function NoteList({ notes, showNamespace, showUpdated }: NoteListProps) {
  return (
    <ul className="divide-y divide-line-2 overflow-hidden rounded-lg border border-line bg-paper">
      {notes.map((n) => (
        <li key={n.id}>
          <Link
            href={noteHref(n)}
            className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-bg"
          >
            <TypeIcon type={n.type} className="mt-[3px] shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[14px] font-medium text-ink">{n.title}</p>
                {n.status === "draft" ? (
                  <span className="text-[11px] font-medium text-warn">Draft</span>
                ) : null}
                {n.status === "deprecated" ? (
                  <span className="text-[11px] font-medium text-bad">Deprecated</span>
                ) : null}
              </div>
              {n.description ? (
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">
                  {n.description}
                </p>
              ) : null}
            </div>
            <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
              <TrustBadge tier={n.trustTier} compact />
              {showNamespace && n.namespace ? (
                <span className="text-xs text-faint">{n.namespace}</span>
              ) : null}
              {showUpdated ? (
                <span className="text-xs text-faint">{timeAgo(n.lastChangedAt)}</span>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
