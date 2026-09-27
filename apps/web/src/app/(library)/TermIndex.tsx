import Link from "next/link";
import type { TermRow } from "@lore/db";
import { termHref } from "@/lib/urls";

interface TermIndexProps {
  kind: "theme" | "system";
  terms: TermRow[];
  counts: Map<string, number>;
}

/** Grid of Theme or System hubs with member counts. */
export function TermIndex({ kind, terms, counts }: TermIndexProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {terms.map((t) => (
        <li key={t.slug}>
          <Link
            href={termHref(kind, t.slug)}
            className="group block h-full rounded-lg border border-line bg-paper p-4 transition-colors hover:border-faint/50 hover:bg-bg"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[14px] font-medium text-ink group-hover:text-accent">{t.title}</p>
              <span className="text-xs tabular-nums text-faint">{counts.get(t.slug) ?? 0}</span>
            </div>
            <p className="mt-1 line-clamp-3 text-[13px] leading-snug text-muted">{t.description}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
