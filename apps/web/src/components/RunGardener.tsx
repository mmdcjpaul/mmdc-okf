"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState } from "react";
import { adminInput, adminQuiet } from "./admin-styles";

interface Result {
  ok: boolean;
  message: string;
}

interface RunGardenerProps {
  action: (prev: Result | null, form: FormData) => Promise<Result>;
  /** Namespaces the person may run it for. */
  namespaces: { slug: string; title: string }[];
  /** Whether they may run it for the whole vault. */
  vault: boolean;
  selected: string;
  /** The newest run the page knows of. When it changes, the run that was asked for is in. */
  latest: string | null;
  running: boolean;
}

/** Asks for a Gardener run, then keeps the page fresh until the run shows up. */
export function RunGardener(props: RunGardenerProps) {
  const router = useRouter();
  const id = useId();
  const [state, run, pending] = useActionState(props.action, null);
  const [waitingSince, setWaitingSince] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (state?.ok) setWaitingSince(props.latest);
    // Only a new answer from the action starts the wait, so `latest` is read, not watched.
  }, [state]);

  const waiting = waitingSince !== undefined && (waitingSince === props.latest || props.running);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 1500);
    const giveUp = setTimeout(() => setWaitingSince(undefined), 120_000);
    return () => {
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [waiting, router]);

  return (
    <form action={run} className="mt-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={id} className="block text-[13px] font-medium text-ink">
            Run it now for
          </label>
          <select
            id={id}
            name="namespace"
            defaultValue={props.selected}
            className={`${adminInput} mt-1 w-56`}
          >
            {props.vault ? <option value="">The whole vault</option> : null}
            {props.namespaces.map((n) => (
              <option key={n.slug} value={n.slug}>
                {n.title}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={adminQuiet} disabled={pending || waiting || props.running}>
          {pending || waiting ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
          Run the Gardener
        </button>
      </div>
      <p
        role="status"
        className={`mt-1.5 min-h-5 text-[13px] ${state?.ok === false ? "text-bad" : "text-muted"}`}
      >
        {waiting ? "The Gardener is at work. This page updates by itself." : (state?.message ?? "")}
      </p>
    </form>
  );
}
