import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ChipProps {
  href?: string;
  children: ReactNode;
  tone?: "neutral" | "accent";
  icon?: ReactNode;
}

export function Chip({ href, children, tone = "neutral", icon }: ChipProps) {
  const className = cn(
    "inline-flex h-6 max-w-full items-center gap-1 rounded-md px-2 text-xs transition-colors",
    tone === "accent"
      ? "bg-accent-soft text-accent hover:brightness-95"
      : "bg-line-2 text-ink-2 hover:bg-hover hover:text-ink",
  );
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <span className={className}>{content}</span>
  );
}
