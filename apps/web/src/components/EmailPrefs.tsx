"use client";

import { useState } from "react";

interface EmailPrefsProps {
  email: string;
  notifications: boolean;
  digest: boolean;
}

export function EmailPrefs({ email, notifications, digest }: EmailPrefsProps) {
  const [state, setState] = useState({ emailNotifications: notifications, emailDigest: digest });
  const [status, setStatus] = useState("");

  async function change(key: keyof typeof state, value: boolean) {
    const before = state;
    setState({ ...state, [key]: value });
    setStatus("");
    const res = await fetch("/api/prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => null);
    if (res?.ok) setStatus("Saved");
    else {
      setState(before);
      setStatus("Not saved. Try again.");
    }
  }

  const row = "flex items-start gap-2.5 text-[14px] text-ink";
  return (
    <fieldset className="rounded-lg border border-line p-4">
      <legend className="px-1 text-[13px] font-semibold text-ink">Email to {email}</legend>
      <div className="space-y-2.5">
        <label className={row}>
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--accent)]"
            checked={state.emailNotifications}
            onChange={(e) => void change("emailNotifications", e.target.checked)}
          />
          <span>
            Notifications
            <span className="block text-[13px] text-muted">
              What is listed on this page, if you have not read it here first.
            </span>
          </span>
        </label>
        <label className={row}>
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--accent)]"
            checked={state.emailDigest}
            onChange={(e) => void change("emailDigest", e.target.checked)}
          />
          <span>
            Weekly digest
            <span className="block text-[13px] text-muted">
              On Mondays: notes your teams own that are due for review, reported, or never verified,
              and reviews that have waited more than five working days.
            </span>
          </span>
        </label>
      </div>
      <p role="status" className="mt-2 min-h-5 text-[13px] text-muted">
        {status}
      </p>
    </fieldset>
  );
}
