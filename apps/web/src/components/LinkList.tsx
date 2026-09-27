import Link from "next/link";
import { TypeIcon } from "./TypeIcon";

export interface LinkListItem {
  id: string;
  href: string;
  title: string;
  type: string;
  hint?: string | null;
}

interface LinkListProps {
  items: LinkListItem[];
  empty: string;
  limit?: number;
}

export function LinkList({ items, empty, limit = 12 }: LinkListProps) {
  if (items.length === 0) return <p className="text-[13px] text-faint">{empty}</p>;
  const shown = items.slice(0, limit);
  return (
    <ul className="-mx-2 space-y-0.5">
      {shown.map((i) => (
        <li key={i.id}>
          <Link
            href={i.href}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
          >
            <TypeIcon type={i.type} size={14} className="mt-[3px] shrink-0 text-faint" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink-2">{i.title}</span>
              {i.hint ? (
                <span className="block truncate text-[11.5px] text-faint">{i.hint}</span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
      {items.length > limit ? (
        <li className="px-2 pt-1 text-xs text-faint">and {items.length - limit} more</li>
      ) : null}
    </ul>
  );
}
