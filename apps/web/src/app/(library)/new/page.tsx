import type { Metadata } from "next";
import { TYPE_TEMPLATES, templateBody } from "@lore/okf";
import { EmptyState } from "@lore/ui";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { requireContext } from "@/lib/context";
import { limitsOf, namespacesFor, vocabulary } from "@/lib/editor";

interface Props {
  searchParams: Promise<{ ns?: string; type?: string; title?: string }>;
}

export const metadata: Metadata = { title: "New note" };

export default async function NewNotePage({ searchParams }: Props) {
  const ctx = await requireContext();
  const query = await searchParams;
  const [vocab, namespaces] = await Promise.all([vocabulary(ctx.vault), namespacesFor(ctx)]);
  if (namespaces.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-16">
        <EmptyState title="There is nowhere to write yet">
          You cannot read any namespace. Ask an admin for access.
        </EmptyState>
      </div>
    );
  }
  const root = ctx.vault.bundleRoot.replace(/\/+$/, "");
  const namespace = namespaces.find((n) => n.slug === query.ns)?.slug ?? namespaces[0]!.slug;
  const type = vocab.types.includes(query.type ?? "") ? query.type! : "How-To";
  const body = templateBody(type in TYPE_TEMPLATES ? type : "How-To", []);

  return (
    <NoteEditor
      mode="create"
      note={{
        id: null,
        slug: "",
        namespace,
        path: `${root}/${namespace}/new-note.md`,
        blobSha: null,
        data: { type, title: (query.title ?? "").slice(0, 160) },
        body,
        isHub: false,
      }}
      vocabulary={vocab}
      bundleRoot={root}
      writes={namespaces[0]!.writes}
      namespaces={namespaces}
      cancelHref="/"
      limits={limitsOf(ctx)}
    />
  );
}
