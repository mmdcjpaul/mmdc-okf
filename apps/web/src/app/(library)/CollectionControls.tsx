import Link from "next/link";
import { cn } from "@lore/ui";

export type View = "table" | "cards";
export type Sort = "updated" | "title" | "health";

interface CollectionControlsProps {
  basePath: string;
  view: View;
  sort: Sort;
  namespace: string | null;
  namespaces: string[];
}

const SORTS: { key: Sort; label: string }[] = [
  { key: "updated", label: "Last update" },
  { key: "title", label: "Title" },
  { key: "health", label: "Health" },
];

/** View, sort, and namespace filter for a collection, kept in the URL. */
export function CollectionControls({
  basePath,
  view,
  sort,
  namespace,
  namespaces,
}: CollectionControlsProps) {
  const href = (next: Partial<{ view: View; sort: Sort; ns: string | null }>) => {
    const sp = new URLSearchParams();
    const v = next.view ?? view;
    const s = next.sort ?? sort;
    const n = next.ns === undefined ? namespace : next.ns;
    if (v !== "table") sp.set("view", v);
    if (s !== "updated") sp.set("sort", s);
    if (n) sp.set("ns", n);
    const q = sp.toString();
    return q ? `${basePath}?${q}` : basePath;
  };
  const pill = (active: boolean) =>
    cn(
      "rounded-md px-2.5 py-1 text-[13px] transition-colors",
      active ? "bg-paper font-medium text-ink shadow-sm" : "text-muted hover:text-ink",
    );

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg bg-line-2 p-0.5" role="group" aria-label="View">
        <Link
          href={href({ view: "table" })}
          aria-current={view === "table" ? "true" : undefined}
          className={pill(view === "table")}
        >
          Table
        </Link>
        <Link
          href={href({ view: "cards" })}
          aria-current={view === "cards" ? "true" : undefined}
          className={pill(view === "cards")}
        >
          Cards
        </Link>
      </div>
      <div className="flex rounded-lg bg-line-2 p-0.5" role="group" aria-label="Sort by">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={href({ sort: s.key })}
            aria-current={sort === s.key ? "true" : undefined}
            className={pill(sort === s.key)}
          >
            {s.label}
          </Link>
        ))}
      </div>
      {namespaces.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Namespace">
          <Link href={href({ ns: null })} className={pill(!namespace)}>
            All
          </Link>
          {namespaces.map((n) => (
            <Link key={n} href={href({ ns: n })} className={pill(namespace === n)}>
              {n}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
