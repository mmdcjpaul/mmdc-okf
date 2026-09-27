"use client";

import { Check, Link2 } from "lucide-react";
import { useState } from "react";

const RESET_MS = 1600;

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href.split("#")[0]!);
      setCopied(true);
      setTimeout(() => setCopied(false), RESET_MS);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 text-[13px] text-ink-2 hover:bg-bg hover:text-ink"
    >
      {copied ? (
        <Check size={14} className="text-ok" aria-hidden />
      ) : (
        <Link2 size={14} aria-hidden />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
    </button>
  );
}
