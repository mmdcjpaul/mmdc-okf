"use client";

import { Bell, BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface FollowButtonProps {
  /** A note id, or a hub as `theme:<slug>` or `system:<slug>`. */
  target: string;
  following: boolean;
  /** What is followed, for screen readers: "this note", "Enrollment". */
  name: string;
}

export function FollowButton({ target, following, name }: FollowButtonProps) {
  const router = useRouter();
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setBusy(true);
    setFailed(false);
    const res = await fetch("/api/follows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, follow: !on }),
    }).catch(() => null);
    if (res?.ok) {
      setOn(!on);
      router.refresh();
    } else setFailed(true);
    setBusy(false);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
        aria-label={`Follow ${name}`}
        title={on ? "You are told when its process changes" : "Be told when its process changes"}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 text-[13px] text-ink-2 hover:bg-bg hover:text-ink disabled:opacity-50"
      >
        {on ? (
          <BellRing size={14} className="text-accent" aria-hidden />
        ) : (
          <Bell size={14} aria-hidden />
        )}
        {on ? "Following" : "Follow"}
      </button>
      <span role="status" className="text-[12.5px] text-bad">
        {failed ? "Not saved. Try again." : ""}
      </span>
    </span>
  );
}
