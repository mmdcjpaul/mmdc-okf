import type { ComponentType, ReactNode } from "react";
import { cn } from "./cn.ts";

/** The host app's link component, so navigation stays client-side (for example `next/link`). */
export type LinkComponent = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
}>;

export interface ChipProps {
  href?: string;
  /** Used when `href` is set. Defaults to a plain anchor. */
  link?: LinkComponent;
  children: ReactNode;
  tone?: "neutral" | "accent";
  icon?: ReactNode;
}

export function Chip({ href, link: Link, children, tone = "neutral", icon }: ChipProps) {
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
  if (href && Link) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return href ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  );
}
