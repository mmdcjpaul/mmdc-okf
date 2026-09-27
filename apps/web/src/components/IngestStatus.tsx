"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

interface Status {
  state: string;
  reason: string | null;
  changesetId: string | null;
  changesetState: string | null;
}

const WORKING = new Set(["extracting", "atomizing"]);
const LABEL: Record<string, string> = {
  queued: "Waiting in the queue",
  extracting: "Reading the file",
  atomizing: "Drafting notes",
  batched: "Sent to the model in a batch",
  waiting: "Waiting",
  done: "Done",
  failed: "Not processed",
};

/** Follows an item while it is processed, and offers Process now to those who may. */
export function IngestStatus(props: { id: string; initial: Status; canProcess: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(props.initial);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A queued item may have been started a moment ago, by this person or by a writer, so the
  // page keeps looking, slowly, for as long as it is open.
  const moving =
    WORKING.has(status.state) ||
    status.state === "queued" ||
    status.state === "batched" ||
    started ||
    (status.state === "done" &&
      ["submitted", "committing", "approved"].includes(status.changesetState ?? ""));

  const [age, setAge] = useState(0);
  const slow = ["queued", "batched"].includes(status.state) && !started && age > 20;
  useEffect(() => {
    const t = setInterval(() => setAge((a) => a + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(
      async () => {
        try {
          const res = await fetch(`/api/ingest/${props.id}`, { cache: "no-store" });
          if (!res.ok) return;
          const next = (await res.json()) as Status;
          if (!["queued", "batched"].includes(next.state)) setStarted(false);
          setStatus((cur) => {
            if (cur.state !== next.state || cur.changesetState !== next.changesetState)
              router.refresh();
            return next;
          });
        } catch {
          // Keep waiting; the next tick tries again.
        }
      },
      slow ? 3000 : 900,
    );
    return () => clearInterval(timer);
  }, [moving, slow, props.id, router]);

  async function processNow() {
    setError(null);
    setStarted(true);
    const res = await fetch(`/api/ingest/${props.id}`, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setStarted(false);
      setError(
        ((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ??
          "Processing could not be started.",
      );
    }
  }

  const spinning = moving && !(["queued", "batched"].includes(status.state) && !started);
  return (
    <div aria-live="polite">
      <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
        {spinning ? <Loader2 size={16} className="animate-spin text-muted" aria-hidden /> : null}
        {started && ["queued", "batched"].includes(status.state)
          ? "Starting"
          : (LABEL[status.state] ?? status.state)}
      </p>
      {status.reason ? <p className="mt-1 text-[14px] text-ink-2">{status.reason}</p> : null}
      {status.state === "queued" && !started ? (
        <p className="mt-1 text-[14px] text-muted">
          {props.canProcess
            ? "Nothing has been processed yet."
            : "A writer in the namespace will process it."}
        </p>
      ) : null}
      {status.state === "batched" && !started ? (
        <p className="mt-1 text-[14px] text-muted">
          Batches cost about half as much. The answer usually arrives within an hour, and always
          within a day.
          {props.canProcess ? " Process now does not wait, at the normal price." : ""}
        </p>
      ) : null}
      {props.canProcess && ["queued", "batched", "waiting"].includes(status.state) && !started ? (
        <button
          type="button"
          onClick={() => void processNow()}
          className="mt-3 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[14px] font-medium text-accent-ink hover:brightness-110"
        >
          Process now
        </button>
      ) : null}
      {status.changesetId ? (
        <p className="mt-3 text-[14px]">
          <Link
            href={`/changes/${status.changesetId}`}
            className="font-medium text-accent hover:underline"
          >
            See what it produced
          </Link>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13.5px] text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
