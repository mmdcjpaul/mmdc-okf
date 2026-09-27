import type { NoteCard } from "@lore/db";
import { EmptyState } from "@lore/ui";
import { NoteTable } from "@/components/NoteTable";
import { CollectionControls, type Sort, type View } from "./CollectionControls";
import { NoteCards } from "./NoteCards";

type Params = Record<string, string | string[] | undefined>;

export function collectionParams(params: Params): { view: View; sort: Sort; ns: string | null } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const view = one(params.view) === "cards" ? "cards" : "table";
  const s = one(params.sort);
  const sort: Sort = s === "title" || s === "health" ? s : "updated";
  return { view, sort, ns: one(params.ns) ?? null };
}

interface CollectionProps {
  basePath: string;
  notes: NoteCard[];
  namespaces: string[];
  view: View;
  sort: Sort;
  ns: string | null;
}

export function Collection({ basePath, notes, namespaces, view, sort, ns }: CollectionProps) {
  return (
    <>
      <CollectionControls
        basePath={basePath}
        view={view}
        sort={sort}
        namespace={ns}
        namespaces={namespaces}
      />
      {notes.length === 0 ? (
        <EmptyState title="No notes here" />
      ) : view === "cards" ? (
        <NoteCards notes={notes} />
      ) : (
        <NoteTable notes={notes} />
      )}
    </>
  );
}
