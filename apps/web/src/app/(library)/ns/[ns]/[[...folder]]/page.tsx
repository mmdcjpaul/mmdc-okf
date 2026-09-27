import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Folder } from "lucide-react";
import { listNamespaces, listNotes, subfolders } from "@lore/db";
import { EmptyState } from "@/components/EmptyState";
import { NoteList } from "@/components/NoteList";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural, titleCase } from "@/lib/format";
import { folderHref } from "@/lib/urls";

interface Props {
  params: Promise<{ ns: string; folder?: string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ns, folder } = await params;
  return {
    title: folder?.length
      ? titleCase(decodeURIComponent(folder.at(-1)!))
      : titleCase(decodeURIComponent(ns)),
  };
}

export default async function FolderPage({ params }: Props) {
  const p = await params;
  const ns = decodeURIComponent(p.ns);
  const folder = (p.folder ?? []).map(decodeURIComponent).join("/");
  const { vault, scope } = await requireContext();
  if (!scope.namespaces.includes(ns)) hidden();
  const namespace = (await listNamespaces(db(), vault.id)).find((n) => n.slug === ns);
  if (!namespace) hidden();
  const [folders, notes] = await Promise.all([
    subfolders(db(), scope, ns, folder),
    listNotes(db(), scope, { namespace: ns, folder, deprecated: true }),
  ]);
  if (folder && folders.length === 0 && notes.length === 0) hidden();

  const segs = folder ? folder.split("/") : [];
  const eyebrow = (
    <>
      <Link href="/ns" className="hover:text-ink">
        Namespaces
      </Link>
      <ChevronRight size={13} aria-hidden />
      <Link href={folderHref(ns)} className="hover:text-ink">
        {namespace.title}
      </Link>
      {segs.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight size={13} aria-hidden />
          <Link href={folderHref(ns, segs.slice(0, i + 1).join("/"))} className="hover:text-ink">
            {titleCase(s)}
          </Link>
        </span>
      ))}
    </>
  );

  return (
    <div className="mx-auto max-w-[960px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        eyebrow={
          segs.length ? (
            eyebrow
          ) : (
            <Link href="/ns" className="hover:text-ink">
              Namespaces
            </Link>
          )
        }
        title={segs.length ? titleCase(segs.at(-1)!) : namespace.title}
        description={segs.length ? undefined : namespace.description}
      />
      {folders.length ? (
        <Section title="Folders">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((f) => (
              <li key={f.folder}>
                <Link
                  href={folderHref(ns, f.folder)}
                  className="flex items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3 transition-colors hover:bg-bg"
                >
                  <Folder size={16} className="text-muted" aria-hidden />
                  <span className="flex-1 truncate text-[14px] font-medium text-ink">
                    {titleCase(f.folder.split("/").at(-1)!)}
                  </span>
                  <span className="text-xs tabular-nums text-faint">{f.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={notes.length ? plural(notes.length, "note") : "Notes"}>
        {notes.length ? (
          <NoteList notes={notes} showUpdated />
        ) : (
          <EmptyState title="No notes directly in this folder" />
        )}
      </Section>
    </div>
  );
}
