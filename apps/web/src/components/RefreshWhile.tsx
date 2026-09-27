"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Reloads the page's data while something is still being worked on, then stops. */
export function RefreshWhile({ active, everyMs = 1500 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
