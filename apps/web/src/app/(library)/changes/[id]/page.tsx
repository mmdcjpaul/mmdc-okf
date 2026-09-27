import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText, Image as ImageIcon } from "lucide-react";
import { getChangeset } from "@lore/db";
import { Banner } from "@lore/ui";
import { StateBadge } from "@/components/ChangesetState";
import { DiffSummary, DiffTable } from "@/components/DiffTable";
import { ReviewControls, WithdrawButton } from "@/components/ReviewControls";
import { canApproveChangeset, canSeeChangeset } from "@/lib/changesets";
import {
  changesetFiles,
  changesetNote,
  changesetPeople,
  similarTo,
  type FileView,
} from "@/lib/changeset-view";
import { hidden, requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { plural, shortDate, timeAgo } from "@/lib/format";
import { noteHref } from "@/lib/urls";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: "Change" };

const SOURCE: Record<string, string> = {
  editor: "Edited in the Library",
  suggest: "Suggested edit",
  upload: "From an upload",
  capture: "From a capture",
  gardener: "Proposed by the Gardener",
  agent: "From an agent",
};
const CLASS: Record<string, string> = {
  fix: "Fix",
  addition: "Addition",
  process: "Process change",
};
const DECISION: Record<string, string> = {
  approve: "approved this",
  request_changes: "requested changes",
  reject: "rejected this",
};

/** One changeset: what it does, why it needs review, and what the viewer can do about it. */
export default async function ChangesetPage({ params }: Props) {
  const ctx = await requireContext();
  const cs = await getChangeset(db(), (await params).id);
  if (!cs || !canSeeChangeset(ctx.principal, cs)) hidden();

  const mine = cs.submitterId === ctx.principal.user.id;
  const [files, people, note] = await Promise.all([
    changesetFiles(ctx, cs),
    changesetPeople(cs),
    changesetNote(ctx, cs),
  ]);
  const similar = cs.state === "in_review" ? await similarTo(ctx, files) : [];
  const reviewing = canApproveChangeset(ctx.principal, cs);
  const errors = cs.issues.filter((i) => i.severity === "error");
  const main = files.filter((f) => f.primary);
  const effects = files.filter((f) => !f.primary);
  const editHref = note ? `/edit/${encodeURIComponent(note.id)}?from=${cs.id}` : null;

  return (
    <div className="mx-auto max-w-[1080px] px-5 pb-20 pt-8 md:px-10">
      <Link
        href={mine ? "/changes" : "/review"}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden />
        {mine ? "My changes" : "Review"}
      </Link>
      <header className="mb-6 mt-3">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="min-w-0 flex-1 text-[24px] font-semibold leading-tight tracking-[-0.015em] text-ink first-letter:uppercase">
            {cs.title || "A change being processed"}
          </h1>
          <StateBadge state={cs.state} />
        </div>
        <p className="mt-2 text-[13.5px] text-muted">
          {people.submitter?.name ?? "Lore"} · {SOURCE[cs.source]} · {CLASS[cs.changeClass]} ·{" "}
          {cs.namespaces.join(", ") || "Vocabulary"} ·{" "}
          <span title={cs.createdAt.toISOString()}>{timeAgo(cs.createdAt)}</span>
        </p>
        {cs.reason ? (
          <blockquote className="mt-3 border-l-2 border-line pl-3 text-[14.5px] text-ink-2">
            {cs.reason}
          </blockquote>
        ) : null}
        {note && cs.state !== "committed" ? (
          <p className="mt-2 text-[13.5px]">
            <Link href={noteHref(note)} className="text-accent hover:underline">
              Open the note as it is now
            </Link>
          </p>
        ) : null}
      </header>

      <div className="space-y-3">
        {cs.state === "committed" ? (
          <Banner kind="info" title="Published">
            {cs.committedAt ? `On ${shortDate(cs.committedAt)}` : "Done"}
            {cs.commitSha ? (
              <>
                , as commit{" "}
                <code className="font-mono text-[12.5px]">{cs.commitSha.slice(0, 7)}</code>
              </>
            ) : null}
            .{" "}
            {note ? (
              <Link href={noteHref(note)} className="font-medium underline">
                Open the note
              </Link>
            ) : null}
          </Banner>
        ) : null}
        {cs.state === "conflicted" ? (
          <Banner kind="stale" title="Someone else changed this note in the meantime">
            Nothing was overwritten.{" "}
            {mine && editHref ? (
              <Link href={editHref} className="font-medium underline">
                Combine the two versions
              </Link>
            ) : (
              "Its author has to combine the two versions."
            )}
            {cs.conflicts.length ? (
              <span className="mt-1 block font-mono text-[12.5px] text-muted">
                {cs.conflicts.join(", ")}
              </span>
            ) : null}
          </Banner>
        ) : null}
        {cs.state === "draft" ? (
          <Banner kind="reported" title={cs.error ?? "There are problems to fix"}>
            {mine && editHref ? (
              <Link href={editHref} className="font-medium underline">
                Open it in the editor
              </Link>
            ) : null}
          </Banner>
        ) : null}
        {cs.state === "changes_requested" ? (
          <Banner kind="stale" title="A reviewer asked for changes">
            {mine && editHref ? (
              <Link href={editHref} className="font-medium underline">
                Open it in the editor
              </Link>
            ) : (
              "Waiting for its author."
            )}
          </Banner>
        ) : null}
        {cs.state === "rejected" ? (
          <Banner kind="reported" title="Not published">
            {cs.error}
          </Banner>
        ) : null}
      </div>

      {cs.reviewReasons.length && cs.state !== "committed" ? (
        <section aria-label="Why this needs review" className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
            Why this needs review
          </h2>
          <ul className="space-y-1.5">
            {cs.reviewReasons.map((r) => (
              <li
                key={r.code}
                className="flex items-baseline gap-2 rounded-md bg-bg px-3 py-2 text-[13.5px] text-ink-2"
              >
                <span className="flex-1">{r.message}</span>
                <span className="shrink-0 text-[12px] text-muted">
                  {r.level === "maintain" ? "Maintainer" : "Writer"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cs.aiSummary ? (
        <section aria-label="What the AI did" className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
            What the AI did
          </h2>
          <p className="whitespace-pre-line rounded-md bg-bg px-3 py-2 text-[14px] text-ink-2">
            {cs.aiSummary}
          </p>
        </section>
      ) : null}

      {errors.length || cs.warnings.length ? (
        <section aria-label="Checks" className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
            Checks
          </h2>
          <ul className="space-y-1 text-[13.5px]">
            {errors.map((i, n) => (
              <li key={`e${n}`} className="rounded-md bg-bad-soft px-3 py-1.5 text-ink-2">
                {i.message}
                <span className="ml-2 font-mono text-[12px] text-muted">
                  {i.path}
                  {i.line ? `:${i.line}` : ""}
                </span>
              </li>
            ))}
            {cs.warnings.map((w, n) => (
              <li key={`w${n}`} className="rounded-md bg-warn-soft px-3 py-1.5 text-ink-2">
                {w}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {people.reviews.length ? (
        <section aria-label="Reviews" className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
            Reviews
          </h2>
          <ul className="space-y-2">
            {people.reviews.map((r) => (
              <li key={r.id} className="rounded-md border border-line px-3 py-2 text-[13.5px]">
                <p className="text-ink">
                  <span className="font-medium">{r.reviewerName ?? "Someone"}</span>{" "}
                  {DECISION[r.decision]}
                  <span className="ml-2 text-muted">{timeAgo(r.createdAt)}</span>
                </p>
                {r.comment ? <p className="mt-1 text-ink-2">{r.comment}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {similar.length ? (
        <section aria-label="Similar notes" className="mt-6">
          <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-faint">
            Similar notes
          </h2>
          <p className="mb-2 text-[13px] text-muted">
            If one of these already covers it, ask for the change to be made there instead.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {similar.map((s) => (
              <li key={s.id}>
                <Link
                  href={s.href}
                  className="block rounded-md border border-line px-3 py-2 hover:bg-bg"
                >
                  <span className="block text-[14px] font-medium text-ink">{s.title}</span>
                  <span className="line-clamp-2 text-[13px] leading-snug text-muted">
                    {s.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Changes" className="mt-8">
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-faint">
          {files.length ? plural(files.length, "file") : "Changes"}
        </h2>
        {files.length === 0 ? (
          <p className="text-[14px] text-muted">
            {cs.state === "submitted" || cs.state === "committing"
              ? "Being prepared. Reload in a moment."
              : "The change was not prepared, so there is nothing to show."}
          </p>
        ) : null}
        <div className="space-y-6">
          {main.map((f) => (
            <FileBlock key={f.path} file={f} open />
          ))}
        </div>
        {effects.length ? (
          <details className="mt-6">
            <summary className="cursor-pointer text-[13.5px] font-medium text-ink-2">
              {plural(effects.length, "other file")} changed as a result (links, logs)
            </summary>
            <div className="mt-4 space-y-6">
              {effects.map((f) => (
                <FileBlock key={f.path} file={f} />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <div className="mt-10 space-y-3">
        {reviewing ? (
          <>
            {note && cs.intents.some((i) => i.type === "edit") ? (
              <p className="text-[13.5px]">
                <Link
                  href={`/edit/${encodeURIComponent(note.id)}?review=${cs.id}`}
                  className="font-medium text-accent hover:underline"
                >
                  Edit before approving
                </Link>
              </p>
            ) : null}
            <ReviewControls id={cs.id} level={cs.approverLevel ?? "write"} />
          </>
        ) : null}
        {mine && ["draft", "conflicted", "in_review", "changes_requested"].includes(cs.state) ? (
          <WithdrawButton id={cs.id} />
        ) : null}
      </div>
    </div>
  );
}

const CHANGE: Record<FileView["change"], string> = {
  added: "New",
  changed: "Changed",
  deleted: "Deleted",
};

function FileBlock({ file, open }: { file: FileView; open?: boolean }) {
  const Icon = file.kind === "image" ? ImageIcon : FileText;
  return (
    <article aria-label={file.title}>
      <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          <Icon size={15} className="text-muted" aria-hidden />
          {file.title}
        </h3>
        <span className="text-[12.5px] text-muted">{CHANGE[file.change]}</span>
        <code className="font-mono text-[12px] text-muted">{file.path}</code>
      </header>
      {file.kind === "image" ? (
        <p className="text-[13.5px] text-muted">
          An image{file.bytes ? ` of ${Math.max(1, Math.round(file.bytes / 1024))} KB` : ""}.
        </p>
      ) : file.diff && file.diff.hunks.length ? (
        <>
          <div className="mb-2">
            <DiffSummary diff={file.diff} />
          </div>
          <DiffTable diff={file.diff} label={`Changes to ${file.title}`} />
          {file.rendered !== null && file.change !== "deleted" ? (
            <details className="mt-3" open={open && file.change === "added"}>
              <summary className="cursor-pointer text-[13.5px] font-medium text-ink-2">
                How it will read
              </summary>
              <div
                className="note-body mt-2 rounded-lg border border-line px-5 pb-5"
                dangerouslySetInnerHTML={{ __html: file.rendered }}
              />
            </details>
          ) : null}
        </>
      ) : (
        <p className="text-[13.5px] text-muted">Moved without changing its text.</p>
      )}
    </article>
  );
}
