import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getNote, noteCommit } from "@lore/db";
import { Banner } from "@lore/ui";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { diffNote, type DiffLine } from "@/lib/diff";
import { plural, shortDate } from "@/lib/format";
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
          <p className="mb-3 text-[13px] text-muted">
            <span className="font-medium text-ok">{plural(diff.added, "line")} added</span>
            {" · "}
            <span className="font-medium text-bad">{plural(diff.removed, "line")} removed</span>
          </p>
          <div
            role="table"
            aria-label="Changes in this commit"
            className="overflow-x-auto rounded-lg border border-line font-mono text-[12.5px] leading-[1.55]"
          >
            {diff.hunks.map((hunk, i) => (
              <div key={i} role="rowgroup">
                {hunk.skipped ? <Skipped count={hunk.skipped} /> : null}
                {hunk.lines.map((l, j) => (
                  <Line key={j} line={l} />
                ))}
              </div>
            ))}
            {diff.trailing ? <Skipped count={diff.trailing} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

function Skipped({ count }: { count: number }) {
  return (
    <div role="row" className="border-y border-line bg-bg px-3 py-1 text-[11.5px] text-faint">
      <span role="cell">{plural(count, "unchanged line")}</span>
    </div>
  );
}

const LINE_STYLE: Record<DiffLine["kind"], string> = {
  same: "text-ink-2",
  add: "bg-ok-soft text-ink",
  remove: "bg-bad-soft text-ink",
};
const MARK: Record<DiffLine["kind"], string> = { same: " ", add: "+", remove: "-" };
const SPOKEN: Record<DiffLine["kind"], string> = { same: "", add: "Added: ", remove: "Removed: " };

function Line({ line }: { line: DiffLine }) {
  return (
    <div role="row" className={`flex min-w-max ${LINE_STYLE[line.kind]}`}>
      <span
        role="cell"
        aria-hidden
        className="w-10 shrink-0 select-none px-2 text-right text-faint"
      >
        {line.before ?? ""}
      </span>
      <span
        role="cell"
        aria-hidden
        className="w-10 shrink-0 select-none px-2 text-right text-faint"
      >
        {line.after ?? ""}
      </span>
      <span role="cell" aria-hidden className="w-5 shrink-0 select-none text-center text-muted">
        {MARK[line.kind]}
      </span>
      <span role="cell" className="whitespace-pre pr-4">
        <span className="sr-only">{SPOKEN[line.kind]}</span>
        {line.text || " "}
      </span>
    </div>
  );
}
