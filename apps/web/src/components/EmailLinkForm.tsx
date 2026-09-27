"use client";

import { useActionState } from "react";

interface Result {
  ok: boolean;
  message: string;
}

export function EmailLinkForm(props: {
  action: (prev: Result | null, form: FormData) => Promise<Result>;
}) {
  const [state, run, pending] = useActionState(props.action, null);
  return (
    <form action={run} className="rounded-xl border border-line bg-paper p-4 shadow-sm">
      <label className="block text-sm font-medium text-ink">
        Work email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 h-10 w-full rounded-md border border-line bg-paper px-3 text-[15px] text-ink"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-3 h-10 w-full rounded-md bg-accent text-sm font-medium text-accent-ink hover:brightness-110 disabled:opacity-50"
      >
        Email me a sign-in link
      </button>
      <p
        role="status"
        className={`mt-2 min-h-5 text-[13px] ${state?.ok === false ? "text-bad" : "text-ink-2"}`}
      >
        {state?.message}
      </p>
    </form>
  );
}
