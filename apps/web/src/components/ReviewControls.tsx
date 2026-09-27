"use client";

import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquare, X } from "lucide-react";
import { useId, useState } from "react";
import { watchChangeset } from "./editor/submit";

type Decision = "approve" | "request_changes" | "reject";

const button =
  "inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50";

/** Approve, request changes, or reject. The last two need a comment for the writer. */
export function ReviewControls({ id, level }: { id: string; level: "write" | "maintain" }) {
  const router = useRouter();
  const ids = useId();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    setBusy(decision === "approve" ? "Publishing…" : "Sending…");
    setError(null);
    try {
      const res = await fetch(`/api/changesets/${id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...(comment.trim() ? { comment: comment.trim() } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "The decision could not be saved.");
        return;
      }
      if (decision === "approve") {
        const outcome = await watchChangeset(id, setBusy);
        if (outcome.kind === "failed") setError(outcome.message);
        if (outcome.kind === "conflict")
          setError("The note changed while this waited. Its author has been asked to merge.");
      }
      router.refresh();
    } catch {
      setError("The Library could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  const needsComment = !comment.trim();
  return (
    <section
      aria-label="Your review"
      className="rounded-lg border border-line bg-bg p-4"
      aria-busy={busy !== null}
    >
      <h2 className="text-[14px] font-semibold text-ink">Your review</h2>
      <p className="mt-0.5 text-[13px] text-muted">
        Approving publishes the change and counts as your verification of the notes it changes.
        {level === "maintain" ? " This one needs a maintainer." : ""}
      </p>
      <label
        htmlFor={`${ids}-comment`}
        className="mb-1 mt-3 block text-[13px] font-medium text-ink"
      >
        Comment
      </label>
      <textarea
        id={`${ids}-comment`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Needed to request changes or to reject"
        className="w-full rounded-md border border-line bg-paper px-2.5 py-2 text-[14px] leading-snug text-ink placeholder:text-faint"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("approve")}
          className={`${button} bg-accent text-accent-ink hover:brightness-110`}
        >
          <Check size={15} aria-hidden />
          Approve and publish
        </button>
        <button
          type="button"
          disabled={busy !== null || needsComment}
          onClick={() => void decide("request_changes")}
          className={`${button} border border-line bg-paper text-ink-2 hover:bg-hover`}
        >
          <MessageSquare size={15} aria-hidden />
          Request changes
        </button>
        <button
          type="button"
          disabled={busy !== null || needsComment}
          onClick={() => void decide("reject")}
          className={`${button} border border-line bg-paper text-bad hover:bg-bad-soft`}
        >
          <X size={15} aria-hidden />
          Reject
        </button>
        {busy ? (
          <span role="status" className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            {busy}
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13.5px] text-bad">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Lets a writer take back a change that has not been published. */
export function WithdrawButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/changesets/${id}`, { method: "DELETE" }).catch(() => null);
        router.refresh();
        setBusy(false);
      }}
      className={`${button} border border-line bg-paper text-ink-2 hover:bg-hover`}
    >
      Withdraw
    </button>
  );
}
