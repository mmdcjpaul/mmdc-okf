import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Pencil } from "lucide-react";
import { getNote, getTerm, linksAmong, listNamespaces, listNotes, type NoteCard } from "@lore/db";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@lore/ui";
import { LocalGraph, type GraphNodeInput } from "@/components/LocalGraph";
import { NoteBody } from "@/components/NoteBody";
import { NoteList } from "@/components/NoteList";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@lore/ui";
import { TypeIcon } from "@/components/TypeIcon";
import { publishes } from "@/lib/changesets";
import { currentVault, hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural } from "@/lib/format";
import { noteHref, termHref } from "@/lib/urls";
import { groupByType, profileTypes } from "./groupByType";

interface HubPageProps {
  kind: "theme" | "system";
  slug: string;
}

const GRAPH_LIMIT = 60;

export async function hubMetadata(kind: "theme" | "system", slug: string): Promise<Metadata> {
  const vault = await currentVault();
  const term = vault ? await getTerm(db(), vault.id, kind, slug) : null;
  return { title: term?.title ?? slug, description: term?.description };
}

/** Theme or System hub: introduction, members grouped by type, a small graph, and owners. */
export async function HubPage({ kind, slug }: HubPageProps) {
  const { vault, scope, principal } = await requireContext();
  const term = await getTerm(db(), vault.id, kind, slug);
  if (!term) hidden();
  const [hub, members, namespaces] = await Promise.all([
    term.hubNoteId ? getNote(db(), scope, term.hubNoteId) : Promise.resolve(null),
    listNotes(
      db(),
      scope,
      kind === "theme" ? { theme: slug, deprecated: true } : { system: slug, deprecated: true },
    ),
    listNamespaces(db(), vault.id),
  ]);
  const nsOwner = new Map(namespaces.map((n) => [n.slug, n.ownerTeam]));
  const groups = groupByType(members, profileTypes(vault.profile));
  const owners = [
    ...new Set(
      members
        .map((m) => m.owner ?? (m.namespace ? nsOwner.get(m.namespace) : null))
        .filter((o): o is string => !!o),
    ),
  ];
  const related = relatedTerms(members, kind === "theme" ? "systems" : "themes");

  const graphMembers = members.slice(0, GRAPH_LIMIT);
  const edges = await linksAmong(
    db(),
    vault.id,
    graphMembers.map((m) => m.id),
  );
  const center = hub ? hub.id : `hub:${slug}`;
  const graphNodes: GraphNodeInput[] = [
    { id: center, title: term.title, href: termHref(kind, slug), role: "center" },
    ...graphMembers.map((m) => ({
      id: m.id,
      title: m.title,
      href: noteHref(m),
      role: "member" as const,
    })),
  ];
  const graphEdges = [
    ...graphMembers.map((m) => ({ source: center, target: m.id })),
    ...edges.filter((e): e is { source: string; target: string } => e.target !== null),
  ];

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        eyebrow={
          <>
            <Link href={kind === "theme" ? "/themes" : "/systems"} className="hover:text-ink">
              {kind === "theme" ? "Themes" : "Systems"}
            </Link>
            <ChevronRight size={13} aria-hidden />
          </>
        }
        title={term.title}
        description={term.description}
      >
        {term.aliases.length ? (
          <p className="mt-3 text-[13px] text-faint">Also called {term.aliases.join(", ")}</p>
        ) : null}
        {hub && publishes(principal, null) ? (
          <p className="mt-4">
            <Link
              href={`/edit/${encodeURIComponent(hub.id)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
            >
              <Pencil size={14} aria-hidden />
              Edit the introduction
            </Link>
          </p>
        ) : null}
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {hub && hub.body.trim() ? (
            <div className="mb-10">
              <NoteBody
                vaultId={vault.id}
                bundleRoot={vault.bundleRoot}
                noteId={hub.id}
                body={hub.body}
                readable={scope.namespaces}
              />
            </div>
          ) : null}
          {groups.length === 0 ? (
            <EmptyState title="No notes you can read belong here yet" />
          ) : null}
          {groups.map(([type, notes]) => (
            <Section
              key={type}
              title={
                <span className="flex items-center gap-1.5">
                  <TypeIcon type={type} size={14} />
                  {type} · {notes.length}
                </span>
              }
            >
              <NoteList notes={notes} showNamespace />
            </Section>
          ))}
        </div>

        <aside className="space-y-8 lg:sticky lg:top-6 lg:self-start">
          <div>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
              Graph
            </h2>
            <LocalGraph nodes={graphNodes} edges={graphEdges} height={260} />
            {members.length > GRAPH_LIMIT ? (
              <p className="mt-1 text-xs text-faint">
                Showing {GRAPH_LIMIT} of {plural(members.length, "note")}
              </p>
            ) : null}
          </div>
          {owners.length ? (
            <div>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
                Owners
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {owners.map((o) => (
                  <Chip key={o}>{o}</Chip>
                ))}
              </div>
            </div>
          ) : null}
          {related.length ? (
            <div>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
                {kind === "theme" ? "Systems involved" : "Themes"}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {related.map(([s, n]) => (
                  <Chip key={s} href={termHref(kind === "theme" ? "system" : "theme", s)}>
                    {s} <span className="text-faint">{n}</span>
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function relatedTerms(members: NoteCard[], field: "themes" | "systems"): [string, number][] {
  const counts = new Map<string, number>();
  for (const m of members) for (const t of m[field]) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12);
}
