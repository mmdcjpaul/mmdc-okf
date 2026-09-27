import Link from "next/link";
import { Check } from "lucide-react";
import type { Facet } from "@lore/search";
import { cn } from "@/lib/cn";

type Params = Record<string, string | string[] | undefined>;

interface FacetGroupProps {
  facet: Facet;
  label: string;
  distribution: Record<string, number>;
  selected: string[];
  params: Params;
}

const MAX_VALUES = 8;

export function FacetGroup({ facet, label, distribution, selected, params }: FacetGroupProps) {
  const values = Object.entries(distribution).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  if (values.length === 0 && selected.length === 0) return null;
  const shown = [...new Set([...selected, ...values.slice(0, MAX_VALUES).map(([v]) => v)])];
  return (
    <fieldset className="mb-5">
      <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
        {label}
      </legend>
      <ul className="space-y-0.5">
        {shown.map((v) => {
          const on = selected.includes(v);
          return (
            <li key={v}>
              <Link
                href={hrefWith(params, facet, v, on)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-hover",
                  on ? "text-ink" : "text-ink-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                    on ? "border-accent bg-accent text-accent-ink" : "border-line",
                  )}
                >
                  {on ? <Check size={10} strokeWidth={3} aria-hidden /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {v}
                  {on ? <span className="sr-only"> (selected, activate to remove)</span> : null}
                </span>
                <span className="text-xs tabular-nums text-faint">{distribution[v] ?? 0}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function hrefWith(params: Params, facet: string, value: string, remove: boolean): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || k === "page") continue;
    for (const x of Array.isArray(v) ? v : [v]) {
      if (k === facet && x === value) continue;
      sp.append(k, x);
    }
  }
  if (!remove) sp.append(facet, value);
  return `/search?${sp.toString()}`;
}
