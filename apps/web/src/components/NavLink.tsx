"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface NavLinkProps {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
  count?: number;
  /** Match only the exact path instead of any path below it. */
  exact?: boolean;
  onNavigate?: () => void;
}

export function NavLink({ href, icon, children, count, exact, onNavigate }: NavLinkProps) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors",
        active ? "bg-hover font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      {icon ? (
        <span className={cn("shrink-0", active ? "text-ink" : "text-muted group-hover:text-ink-2")}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined ? (
        <span className="text-xs tabular-nums text-faint">{count}</span>
      ) : null}
    </Link>
  );
}
