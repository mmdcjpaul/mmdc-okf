import type { ReactNode } from "react";
import { AlertTriangle, Archive, Clock, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export type BannerKind = "draft" | "deprecated" | "stale" | "reported" | "changed" | "info";

const STYLE: Record<BannerKind, { icon: typeof Info; className: string }> = {
  draft: { icon: Info, className: "border-warn/30 bg-warn-soft text-warn" },
  deprecated: { icon: Archive, className: "border-bad/30 bg-bad-soft text-bad" },
  stale: { icon: Clock, className: "border-warn/30 bg-warn-soft text-warn" },
  reported: { icon: AlertTriangle, className: "border-bad/30 bg-bad-soft text-bad" },
  changed: { icon: Sparkles, className: "border-accent/30 bg-accent-soft text-accent" },
  info: { icon: Info, className: "border-info/30 bg-info-soft text-info" },
};

interface BannerProps {
  kind: BannerKind;
  title: string;
  children?: ReactNode;
}

export function Banner({ kind, title, children }: BannerProps) {
  const s = STYLE[kind];
  const Icon = s.icon;
  return (
    <div
      role="note"
      className={cn("flex gap-3 rounded-lg border px-4 py-3 text-[13.5px]", s.className)}
    >
      <Icon size={17} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-0.5 text-ink-2">{children}</div> : null}
      </div>
    </div>
  );
}
