import { BadgeCheck, Bot, CircleDashed } from "lucide-react";
import { cn } from "./cn.ts";

interface TrustBadgeProps {
  tier: string;
  compact?: boolean;
}

const TIERS = {
  human: {
    label: "Verified",
    title: "A person has verified this note",
    icon: BadgeCheck,
    className: "bg-ok-soft text-ok",
  },
  machine: {
    label: "Checked",
    title: "Checked by an automated process only",
    icon: Bot,
    className: "bg-info-soft text-info",
  },
  unverified: {
    label: "Unverified",
    title: "No one has verified this note yet",
    icon: CircleDashed,
    className: "bg-line-2 text-muted",
  },
} as const;

export function TrustBadge({ tier, compact }: TrustBadgeProps) {
  const t = TIERS[tier as keyof typeof TIERS] ?? TIERS.unverified;
  const Icon = t.icon;
  return (
    <span
      title={t.title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium",
        t.className,
      )}
    >
      <Icon size={12} aria-hidden />
      {compact ? <span className="sr-only">{t.label}</span> : t.label}
    </span>
  );
}
