import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getNote, noteCommit } from "@lore/db";
import { Banner } from "@lore/ui";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { DiffSummary, DiffTable } from "@/components/DiffTable";
import { diffNote } from "@/lib/diff";
import { shortDate } from "@/lib/format";
import { noteHref } from "@/lib/urls";
import { fetchFileChange } from "@/lib/worker";

interface Props {
  params: Promise<{ id: string; sha: string }>;
}

export const metadata: Metadata = { title: "Change" };

const CLASS_LABEL: Record<string, string> = {
  fix: "Fix",
  addition: "Addition",
  process: "Process change",
};

export default async function NoteChangePage({ params }: Props) {
  const p = await params;
  const id = decodeURIComponent(p.id);
  const { vault, scope } = await requireContext();
  // The note must be readable and the commit must be part of its history. Anything else 404s,
  // so a commit SHA cannot be used to read a file the person has no access to.
  const note = await getNote(db(), scope, id);
  if (!note) hidden();
  if (!/^[0-9a-f]{40,64}$/.test(p.sha)) hidden();
  const commit = await noteCommit(db(), vault.id, note.id, p.sha);
  if (!commit) hidden();

  const change = await fetchFileChange(vault.id, commit.sha, commit.path);
  const diff = change ? diffNote(change.before, change.after) : null;

  return (
    <div className="mx-auto max-w-[980px] px-5 pb-20 pt-8 md:px-10">
      <Link
        href={noteHref(note)}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden />
        {note.title}
      </Link>
      <header className="mb-6 mt-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{commit.subject}</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          {commit.authorName} · {shortDate(commit.committedAt)}
          {commit.changeClass ? ` · ${CLASS_LABEL[commit.changeClass]}` : ""}
          {commit.fromVersion && commit.toVersion && commit.fromVersion !== commit.toVersion
            ? ` · v${commit.fromVersion} to v${commit.toVersion}`
            : commit.toVersion
              ? ` · v${commit.toVersion}`
              : ""}
          <span className="ml-1.5 font-mono text-faint">{commit.sha.slice(0, 7)}</span>
        </p>
        {change?.fromPath ? (
          <p className="mt-1 text-[13px] text-muted">
            Moved from <code className="font-mono text-[12px]">{change.fromPath}</code>
          </p>
        ) : null}
      </header>

      {!diff ? (
        <Banner kind="info" title="The change cannot be shown right now">
          The history service did not answer. Try again in a moment.
        </Banner>
      ) : diff.hunks.length === 0 ? (
        <p className="text-[14px] text-muted">
          This commit moved the note without changing its text.
        </p>
      ) : (
        <>
          <div className="mb-3">
            <DiffSummary diff={diff} />
          </div>
          <DiffTable diff={diff} label="Changes in this commit" />
        </>
      )}
    </div>
  );
}
