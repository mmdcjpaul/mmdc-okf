import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { FACETS, searchNotes, type Facet, type FacetFilters, type NoteHit } from "@lore/search";
import { Banner } from "@lore/ui";
import { EmptyState } from "@lore/ui";
import { TrustBadge } from "@lore/ui";
import { TypeIcon } from "@/components/TypeIcon";
import { requireContext } from "@/lib/context";
import { embedQuery, meili } from "@/lib/db";
import { plural } from "@/lib/format";
import { noteHref } from "@/lib/urls";
import { FacetGroup } from "./FacetGroup";

export const metadata: Metadata = { title: "Search" };

type Params = Record<string, string | string[] | undefined>;

const FACET_LABELS: Record<Facet, string> = {
  namespace: "Namespace",
  type: "Type",
  themes: "Theme",
  systems: "System",
  tags: "Tag",
  trust_tier: "Trust",
  status: "Status",
};

const PAGE_SIZE = 20;

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { vault, scope } = await requireContext();
  const q = first(params.q) ?? "";
  const page = Math.max(1, Number(first(params.page)) || 1);
  const includeDeprecated = first(params.deprecated) === "1";
  const filters: FacetFilters = {};
  for (const f of FACETS) {
    const v = params[f];
    if (v) filters[f] = Array.isArray(v) ? v : [v];
  }

  const vector = await embedQuery(q);
  let result: Awaited<ReturnType<typeof searchNotes>> | null = null;
  let failed = false;
  try {
    result = await searchNotes(meili(), {
      vaultSlug: vault.slug,
      scope,
      q,
      vector,
      filters,
      includeDeprecated,
      facets: true,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
  } catch {
    failed = true;
  }
  const total = result?.estimatedTotalHits ?? 0;
  const activeCount = Object.values(filters).reduce((s, v) => s + (v?.length ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-8 md:px-10">
      <form action="/search" role="search" className="mb-6">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <div className="flex h-11 items-center gap-3 rounded-lg border border-line bg-paper px-3.5 focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/10">
          <Search size={17} className="text-muted" aria-hidden />
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search the Library"
            className="h-full flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
          />
          {Object.entries(filters).flatMap(([k, vs]) =>
            (vs ?? []).map((v) => <input key={`${k}:${v}`} type="hidden" name={k} value={v} />),
          )}
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:brightness-110"
          >
            Search
          </button>
        </div>
      </form>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside aria-label="Filters" className="order-2 lg:order-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-ink">Filters</h2>
            {activeCount ? (
              <Link
                href={`/search?q=${encodeURIComponent(q)}`}
                className="text-xs text-accent hover:underline"
              >
                Clear {activeCount}
              </Link>
            ) : null}
          </div>
          {FACETS.map((f) => (
            <FacetGroup
              key={f}
              facet={f}
              label={FACET_LABELS[f]}
              distribution={result?.facetDistribution?.[f] ?? {}}
              selected={filters[f] ?? []}
              params={params}
            />
          ))}
          <Link
            href={toggleParam(params, "deprecated", includeDeprecated ? null : "1")}
            className="mt-2 inline-block text-xs text-muted hover:text-ink"
          >
            {includeDeprecated ? "Hide deprecated notes" : "Show deprecated notes"}
          </Link>
        </aside>

        <section aria-label="Results" className="order-1 min-w-0 lg:order-2">
          {failed ? (
            <Banner kind="reported" title="Search is unavailable">
              The search service did not answer. Browsing still works from the sidebar.
            </Banner>
          ) : (
            <>
              <p className="mb-3 text-[13px] text-muted" aria-live="polite">
                {q ? (
                  <>
                    {plural(total, "result")} for “{q}”
                  </>
                ) : (
                  <>{plural(total, "note")}</>
                )}
                {!vector && q ? <span className="ml-2 text-faint">· keyword search</span> : null}
              </p>
              {result && result.hits.length ? (
                <ol className="space-y-1">
                  {result.hits.map((h) => (
                    <SearchResult key={h.id} hit={h} />
                  ))}
                </ol>
              ) : (
                <EmptyState title="No notes match">Try fewer words or clear a filter.</EmptyState>
              )}
              <Pager page={page} total={total} params={params} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function SearchResult({ hit }: { hit: NoteHit }) {
  const f = hit._formatted ?? {};
  return (
    <li>
      <Link
        href={noteHref(hit)}
        className="block rounded-lg px-3 py-3 transition-colors hover:bg-bg"
      >
        <div className="flex items-center gap-2 text-xs text-muted">
          <TypeIcon type={hit.type} size={14} />
          <span>{hit.type}</span>
          <span aria-hidden>·</span>
          <span>{hit.namespace ?? (hit.is_hub ? "Hub" : "")}</span>
          <span className="ml-auto">
            <TrustBadge tier={hit.trust_tier} compact />
          </span>
        </div>
        <p
          className="mt-1 text-[15px] font-medium text-ink"
          dangerouslySetInnerHTML={{ __html: safeHighlight(f.title ?? hit.title) }}
        />
        {f.description || hit.description ? (
          <p
            className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-muted"
            dangerouslySetInnerHTML={{ __html: safeHighlight(f.description ?? hit.description) }}
          />
        ) : null}
        {f.body && f.body.includes("<mark>") ? (
          <p
            className="mt-1 line-clamp-2 text-[13px] leading-snug text-faint"
            dangerouslySetInnerHTML={{ __html: safeHighlight(f.body) }}
          />
        ) : null}
      </Link>
    </li>
  );
}

function Pager({ page, total, params }: { page: number; total: number; params: Params }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-6 flex items-center justify-between text-[13px]">
      {page > 1 ? (
        <Link
          className="text-accent hover:underline"
          href={toggleParam(params, "page", String(page - 1))}
        >
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link
          className="text-accent hover:underline"
          href={toggleParam(params, "page", String(page + 1))}
        >
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Meilisearch highlights are text with <mark> tags; escape everything else. */
function safeHighlight(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function toggleParam(params: Params, key: string, value: string | null): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === key || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) sp.append(k, x);
  }
  if (value !== null) sp.set(key, value);
  return `/search?${sp.toString()}`;
}
