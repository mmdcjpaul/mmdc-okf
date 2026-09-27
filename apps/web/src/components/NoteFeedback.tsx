"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Flag, Loader2, ThumbsUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@lore/ui";

export interface OpenReport {
  id: string;
  reason: string;
  reasonLabel: string;
  comment: string | null;
  reporter: string;
  when: string;
}

export interface NoteFeedbackProps {
  noteId: string;
  helpful: number;
  mine: boolean;
  reasons: { value: string; label: string }[];
  /** Open reports, shown to the note's writers with who filed them. */
  reports: OpenReport[] | null;
}

const button =
  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50";

async function send(method: string, url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "It did not work.";
  } catch {
    return "The Library could not be reached.";
  }
}

/** Helpful and Report an issue, and for writers, the open reports with what to do about them. */
export function NoteFeedback({ noteId, helpful, mine, reasons, reports }: NoteFeedbackProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function toggleHelpful() {
    setBusy(true);
    const error = await send("POST", "/api/feedback", {
      kind: mine ? "not_helpful" : "helpful",
      noteId,
    });
    setBusy(false);
    setMessage(error ? { tone: "bad", text: error } : null);
    router.refresh();
  }

  return (
    <section aria-label="Feedback" className="mt-12 border-t border-line pt-6">
      {reports?.length ? (
        <div className="mb-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-faint">
            Open reports
          </h2>
          <ul className="space-y-2">
            {reports.map((r) => (
              <Report key={r.id} report={r} noteId={noteId} />
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13.5px] text-ink-2">Was this note useful?</span>
        <button
          type="button"
          disabled={busy}
          aria-pressed={mine}
          onClick={() => void toggleHelpful()}
          className={cn(
            button,
            mine
              ? "border-accent bg-accent-soft text-ink"
              : "border-line bg-paper text-ink-2 hover:bg-hover",
          )}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <ThumbsUp size={14} aria-hidden />
          )}
          Helpful
          {helpful ? <span className="tabular-nums text-muted">{helpful}</span> : null}
        </button>
        <button
          type="button"
          onClick={() => setReporting(true)}
          className={cn(button, "border-line bg-paper text-ink-2 hover:bg-hover")}
        >
          <Flag size={14} aria-hidden />
          Report an issue
        </button>
      </div>
      <p
        aria-live="polite"
        className={cn("mt-2 text-[13.5px]", message?.tone === "bad" ? "text-bad" : "text-ok")}
      >
        {message?.text}
      </p>
      {reporting ? (
        <ReportDialog
          noteId={noteId}
          reasons={reasons}
          onClose={(sent) => {
            setReporting(false);
            if (sent) {
              setMessage({ tone: "ok", text: "Thank you. The note's owner has been told." });
              router.refresh();
            }
          }}
        />
      ) : null}
    </section>
  );
}

function Report({ report, noteId }: { report: OpenReport; noteId: string }) {
  const router = useRouter();
  const ids = useId();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <li className="rounded-lg border border-line px-3.5 py-3 text-[13.5px]">
      <p className="text-ink">
        <span className="font-medium">{report.reasonLabel}</span>
        <span className="text-muted">
          {" "}
          · {report.reporter} · {report.when}
        </span>
      </p>
      {report.comment ? <p className="mt-1 text-ink-2">{report.comment}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link
          href={`/edit/${encodeURIComponent(noteId)}?resolves=${report.id}`}
          className="font-medium text-accent hover:underline"
        >
          Fix it
        </Link>
        {dismissing ? null : (
          <button
            type="button"
            onClick={() => setDismissing(true)}
            className="text-muted hover:text-ink"
          >
            Dismiss
          </button>
        )}
      </div>
      {dismissing ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const failed = await send("DELETE", `/api/feedback/${report.id}`, { reason });
            setBusy(false);
            setError(failed);
            if (!failed) router.refresh();
          }}
        >
          <div className="min-w-[220px] flex-1">
            <label htmlFor={`${ids}-why`} className="mb-1 block text-[12.5px] font-medium text-ink">
              Why is nothing changing?
            </label>
            <input
              id={`${ids}-why`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className="h-8 w-full rounded-md border border-line bg-paper px-2 text-[13.5px] text-ink"
            />
          </div>
          <button
            type="submit"
            disabled={busy || reason.trim().length < 3}
            className={cn(button, "border-line bg-paper text-ink-2 hover:bg-hover")}
          >
            Dismiss the report
          </button>
          {error ? (
            <p role="alert" className="w-full text-[13px] text-bad">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

function ReportDialog(props: {
  noteId: string;
  reasons: { value: string; label: string }[];
  onClose: (sent: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${ids}-title`}
      onClose={() => props.onClose(false)}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose(false);
      }}
      className="m-auto w-[calc(100vw-2rem)] max-w-[460px] rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl"
    >
      <form
        className="p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const failed = await send("POST", "/api/feedback", {
            kind: "report",
            noteId: props.noteId,
            reason,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          });
          setBusy(false);
          if (failed) setError(failed);
          else props.onClose(true);
        }}
      >
        <h2 id={`${ids}-title`} className="text-[16px] font-semibold text-ink">
          Report an issue
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          The note&apos;s owner sees your name with the report.
        </p>
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[13px] font-medium text-ink">
            What is wrong? <span className="text-bad">*</span>
          </legend>
          <div className="space-y-1">
            {props.reasons.map((r) => (
              <label
                key={r.value}
                className="flex cursor-pointer items-center gap-2 text-[14px] text-ink-2"
              >
                <input
                  type="radio"
                  name={`${ids}-reason`}
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-[var(--accent)]"
                />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label
          htmlFor={`${ids}-comment`}
          className="mb-1 mt-4 block text-[13px] font-medium text-ink"
        >
          Anything that would help fix it
        </label>
        <textarea
          id={`${ids}-comment`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={1000}
          className="w-full rounded-md border border-line bg-paper px-2.5 py-2 text-[14px] leading-snug text-ink"
        />
        {error ? (
          <p role="alert" className="mt-2 text-[13.5px] text-bad">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => props.onClose(false)}
            className={cn(button, "border-line bg-paper text-ink-2 hover:bg-hover")}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !reason}
            className={cn(
              button,
              "border-transparent bg-accent text-accent-ink hover:brightness-110",
            )}
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            Send the report
          </button>
        </div>
      </form>
    </dialog>
  );
}
