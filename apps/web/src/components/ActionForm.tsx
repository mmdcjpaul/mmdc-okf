"use client";

import { useActionState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { adminQuiet } from "./admin-styles";

interface Result {
  ok: boolean;
  message: string;
}

/** A form bound to a server action, showing what the action answered. */
export function ActionForm(props: {
  action: (prev: Result | null, form: FormData) => Promise<Result>;
  children: ReactNode;
  className?: string;
  /** Asks before submitting, for things that cannot be undone. */
  confirm?: string;
  label?: string;
}) {
  const [state, run, pending] = useActionState(props.action, null);
  return (
    <form
      action={run}
      aria-label={props.label}
      className={props.className}
      aria-busy={pending}
      onSubmit={(e) => {
        if (props.confirm && !window.confirm(props.confirm)) e.preventDefault();
      }}
    >
      {props.children}
      <p
        role="status"
        className={`mt-1.5 min-h-5 text-[13px] ${state?.ok === false ? "text-bad" : "text-ok"}`}
      >
        {pending ? (
          <Loader2 size={13} className="inline animate-spin text-muted" aria-label="Saving" />
        ) : (
          state?.message
        )}
      </p>
    </form>
  );
}

interface KeyTest {
  ok: boolean;
  model: string | null;
  message: string;
  latencyMs: number;
}

export function TestKeyForm(props: {
  action: (prev: KeyTest | null, form: FormData) => Promise<KeyTest>;
  provider: string;
}) {
  const [state, run, pending] = useActionState(props.action, null);
  return (
    <form action={run} className="inline">
      <input type="hidden" name="provider" value={props.provider} />
      <button type="submit" disabled={pending} className={adminQuiet}>
        {pending ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
        Test key
      </button>
      <span role="status" className={`ml-2 text-[13px] ${state?.ok ? "text-ok" : "text-bad"}`}>
        {state
          ? `${state.message}${state.ok && state.model ? ` (${state.model}, ${state.latencyMs} ms)` : ""}`
          : ""}
      </span>
    </form>
  );
}
