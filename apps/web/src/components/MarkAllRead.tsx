"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/notifications", { method: "POST" }).catch(() => null);
        router.refresh();
        setBusy(false);
      }}
      className="inline-flex h-8 items-center rounded-md border border-line bg-paper px-2.5 text-[13px] font-medium text-ink-2 hover:bg-hover disabled:opacity-50"
    >
      Mark all as read
    </button>
  );
}
