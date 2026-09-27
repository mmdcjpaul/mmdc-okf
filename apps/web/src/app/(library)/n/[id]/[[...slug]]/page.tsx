import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronRight,
  ExternalLink,
  GitCommitHorizontal,
  Hash,
  Layers,
  Server,
} from "lucide-react";
import {
  backlinks,
  getNote,
  linksAmong,
  linksFrom,
  listNamespaces,
  noteHistory,
  outgoing,
  type NoteRow,
} from "@lore/db";
import { similarNotes } from "@lore/search";
import { Banner } from "@lore/ui";
import { Chip } from "@/components/Chip";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { LinkList, type LinkListItem } from "@/components/LinkList";
import { LocalGraph, type GraphNodeInput } from "@/components/LocalGraph";
import { NoteBody } from "@/components/NoteBody";
import { PanelSection } from "@lore/ui";
import { TrustBadge } from "@lore/ui";
import { TypeIcon } from "@/components/TypeIcon";
import { currentVault, hidden, requireContext } from "@/lib/context";
import { db, meili } from "@/lib/db";
import { shortDate, timeAgo, titleCase } from "@/lib/format";
import { outline } from "@/lib/markdown";
import { folderHref, noteHref, termHref, typeHref } from "@/lib/urls";

interface Props {
  params: Promise<{ id: string; slug?: string[] }>;
}

const CHANGED_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const vault = await currentVault();
  if (!vault) return {};
  const { scope } = await requireContext();
  const note = await getNote(db(), scope, decodeURIComponent(id));
  return note ? { title: note.title, description: note.description } : { title: "Not found" };
}

export default async function NotePage({ params }: Props) {
  const p = await params;
  const id = decodeURIComponent(p.id);
  const { vault, scope } = await requireContext();
  const note = await getNote(db(), scope, id);
  if (!note) hidden();
  if (note.hubKind) redirect(termHref(note.hubKind, note.slug));
  const slug = p.slug?.map(decodeURIComponent).join("/");
  if (slug !== note.slug) redirect(noteHref(note));

  const [inbound, outbound, history, related, namespaces] = await Promise.all([
    backlinks(db(), scope, note.id),
    outgoing(db(), scope, note.id),
    noteHistory(db(), vault.id, note.id),
    similarNotes(meili(), { vaultSlug: vault.slug, scope, noteId: note.id, limit: 6 }),
    listNamespaces(db(), vault.id),
  ]);
  const ns = namespaces.find((n) => n.slug === note.namespace);
  const owner = note.owner ?? ns?.ownerTeam ?? null;
  const headings = outline(note.body);

  const neighbours = new Map<string, GraphNodeInput>();
  for (const n of outbound)
    neighbours.set(n.id, { id: n.id, title: n.title, href: noteHref(n), role: "out" });
  for (const n of inbound) {
    const both = neighbours.has(n.id);
    neighbours.set(n.id, {
      id: n.id,
      title: n.title,
      href: noteHref(n),
      role: both ? "both" : "in",
    });
  }
  const graphNodes: GraphNodeInput[] = [
    { id: note.id, title: note.title, href: noteHref(note), role: "center" },
    ...neighbours.values(),
  ];
  const graphEdges = (
    await linksAmong(
      db(),
      vault.id,
      graphNodes.map((n) => n.id),
    )
  ).filter((e): e is { source: string; target: string } => e.target !== null);

  const toItem = (n: {
    id: string;
    slug: string;
    title: string;
    type: string;
    namespace: string | null;
  }): LinkListItem => ({
    id: n.id,
    href: noteHref(n),
    title: n.title,
    type: n.type,
    hint: n.namespace,
  });

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-8 md:px-10">
      <div className="grid gap-x-12 lg:grid-cols-[minmax(0,1fr)_288px]">
        <article className="min-w-0 max-w-[740px]">
          <NoteHeader note={note} nsTitle={ns?.title ?? null} owner={owner} />
          <NoteBanners note={note} />
          <NoteBody
            vaultId={vault.id}
            bundleRoot={vault.bundleRoot}
            noteId={note.id}
            body={note.body}
            readable={scope.namespaces}
          />
        </article>

        <aside
          aria-label="About this note"
          className="mt-12 lg:sticky lg:top-6 lg:mt-0 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-6"
        >
          {headings.length > 2 ? (
            <PanelSection title="On this page">
              <ul className="text-[13px]">
                {headings.map((h) => (
                  <li key={h.id} style={{ paddingLeft: (h.depth - 1) * 12 }}>
                    <a
                      href={`#${h.id}`}
                      className="block min-h-6 truncate py-[3px] text-muted hover:text-ink"
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </PanelSection>
          ) : null}
          <PanelSection title="Graph">
            <LocalGraph nodes={graphNodes} edges={graphEdges} />
          </PanelSection>
          <PanelSection title="Backlinks" count={inbound.length}>
            <LinkList items={inbound.map(toItem)} empty="No notes link here yet." />
          </PanelSection>
          <PanelSection title="Links to" count={outbound.length}>
            <LinkList items={outbound.map(toItem)} empty="This note links to no other notes." />
          </PanelSection>
          {related.length ? (
            <PanelSection title="Related">
              <LinkList items={related.map(toItem)} empty="" />
            </PanelSection>
          ) : null}
          <Sources note={note} />
          <PanelSection title="History" count={history.length}>
            {history.length ? (
              <ol className="space-y-2.5">
                {history.map((h) => (
                  <li key={h.sha} className="flex gap-2 text-[13px]">
                    <GitCommitHorizontal
                      size={15}
                      className="mt-0.5 shrink-0 text-faint"
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/n/${encodeURIComponent(note.id)}/history/${h.sha}`}
                        className="block truncate text-ink-2 hover:text-accent hover:underline"
                        title={h.subject}
                      >
                        {h.subject}
                      </Link>
                      <p className="text-[11.5px] text-faint">
                        {h.authorName} · {shortDate(h.committedAt)}
                        {h.toVersion ? ` · v${h.toVersion}` : ""}
                        {h.changeClass ? ` · ${h.changeClass}` : ""}
                        <span className="ml-1 font-mono">{h.sha.slice(0, 7)}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-faint">No commits recorded.</p>
            )}
          </PanelSection>
        </aside>
      </div>
    </div>
  );
}

function NoteHeader({
  note,
  nsTitle,
  owner,
}: {
  note: NoteRow;
  nsTitle: string | null;
  owner: string | null;
}) {
  const folders = note.folder ? note.folder.split("/") : [];
  return (
    <header className="mb-6">
      <nav
        aria-label="Breadcrumb"
        className="mb-3 flex flex-wrap items-center gap-1 text-[13px] text-muted"
      >
        {note.namespace ? (
          <>
            <Link href={folderHref(note.namespace)} className="hover:text-ink">
              {nsTitle ?? note.namespace}
            </Link>
            {folders.map((f, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight size={13} aria-hidden />
                <Link
                  href={folderHref(note.namespace!, folders.slice(0, i + 1).join("/"))}
                  className="hover:text-ink"
                >
                  {titleCase(f)}
                </Link>
              </span>
            ))}
          </>
        ) : (
          <Link
            href={note.hubKind === "system" ? "/systems" : "/themes"}
            className="hover:text-ink"
          >
            {note.hubKind === "system" ? "Systems" : "Themes"}
          </Link>
        )}
      </nav>
      <h1 className="text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink">
        {note.title}
      </h1>
      {note.description ? (
        <p className="mt-2 text-[16px] leading-relaxed text-muted">{note.description}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
        <Link
          href={typeHref(note.type)}
          className="inline-flex items-center gap-1.5 font-medium text-ink-2 hover:text-ink"
        >
          <TypeIcon type={note.type} size={15} />
          {note.type}
        </Link>
        <TrustBadge tier={note.trustTier} />
        {note.version ? <span className="font-mono text-xs">v{note.version}</span> : null}
        <span title={note.lastChangedAt?.toISOString()}>
          Updated {timeAgo(note.lastChangedAt)}
          {note.lastChangedBy ? ` by ${note.lastChangedBy}` : ""}
        </span>
        {owner ? <span>Owner {owner}</span> : null}
        <span className="ml-auto">
          <CopyLinkButton />
        </span>
      </div>

      {note.themes.length + note.systems.length + note.tags.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {note.themes.map((t) => (
            <Chip
              key={`t:${t}`}
              href={termHref("theme", t)}
              tone="accent"
              icon={<Layers size={12} aria-hidden />}
            >
              {titleCase(t)}
            </Chip>
          ))}
          {note.systems.map((s) => (
            <Chip
              key={`s:${s}`}
              href={termHref("system", s)}
              icon={<Server size={12} aria-hidden />}
            >
              {s}
            </Chip>
          ))}
          {note.tags.map((t) => (
            <Chip key={`g:${t}`} href={termHref("tag", t)} icon={<Hash size={12} aria-hidden />}>
              {t}
            </Chip>
          ))}
        </div>
      ) : null}
    </header>
  );
}

function NoteBanners({ note }: { note: NoteRow }) {
  const now = Date.now();
  const banners = [];
  if (note.status === "draft") {
    banners.push(
      <Banner key="draft" kind="draft" title="Draft">
        This note is still being written and may be incomplete.
      </Banner>,
    );
  }
  if (note.status === "deprecated") {
    banners.push(
      <Banner key="dep" kind="deprecated" title="Deprecated">
        Do not follow this note.{note.supersededBy ? <SupersededBy note={note} /> : null}
      </Banner>,
    );
  }
  if (note.staleAfter && note.staleAfter.getTime() <= now) {
    banners.push(
      <Banner key="stale" kind="stale" title="Due for review">
        This note was due for review on {shortDate(note.staleAfter)}. Check with its owner before
        relying on it.
      </Banner>,
    );
  }
  if (note.processChangedAt && now - note.processChangedAt.getTime() < CHANGED_DAYS * DAY_MS) {
    banners.push(
      <Banner key="changed" kind="changed" title="Process changed recently">
        The steps here changed {timeAgo(note.processChangedAt)}. Review the history if you learned
        the old way.
      </Banner>,
    );
  }
  return banners.length ? <div className="mb-8 space-y-2">{banners}</div> : null;
}

async function SupersededBy({ note }: { note: NoteRow }) {
  const { scope } = await requireContext();
  const link = (await linksFrom(db(), note.vaultId, note.id)).find((l) => l.kind === "supersedes");
  const target = link?.targetId ? await getNote(db(), scope, link.targetId) : null;
  return target ? (
    <>
      {" "}
      Use{" "}
      <Link href={noteHref(target)} className="font-medium underline">
        {target.title}
      </Link>{" "}
      instead.
    </>
  ) : null;
}

function Sources({ note }: { note: NoteRow }) {
  const raw = note.frontmatter.sources;
  const sources = Array.isArray(raw)
    ? raw.filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    : [];
  if (sources.length === 0) return null;
  return (
    <PanelSection title="Sources" count={sources.length}>
      <ul className="space-y-2 text-[13px]">
        {sources.map((s, i) => {
          const title =
            typeof s.title === "string"
              ? s.title
              : typeof s.id === "string"
                ? s.id
                : `Source ${i + 1}`;
          const url =
            typeof s.resource === "string" && /^https?:\/\//.test(s.resource) ? s.resource : null;
          return (
            <li key={i} className="flex gap-2">
              <ExternalLink size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 break-words text-ink-2 hover:text-accent"
                >
                  {title}
                </a>
              ) : (
                <span className="min-w-0 break-words text-ink-2">{title}</span>
              )}
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}
