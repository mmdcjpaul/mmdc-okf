import { linksFrom } from "@lore/db";
import { db } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";

interface NoteBodyProps {
  vaultId: string;
  bundleRoot: string;
  noteId: string;
  body: string;
  readable: string[];
}

/** A note body rendered to sanitized HTML with Library links. */
export async function NoteBody({ vaultId, bundleRoot, noteId, body, readable }: NoteBodyProps) {
  const links = await linksFrom(db(), vaultId, noteId);
  const html = await renderMarkdown(body, { bundleRoot, links, readable: new Set(readable) });
  return <div className="note-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
