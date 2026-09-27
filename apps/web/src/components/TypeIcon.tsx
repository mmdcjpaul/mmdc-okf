import {
  BookMarked,
  FileCode2,
  FileText,
  Gavel,
  GitBranch,
  Inbox,
  Layers,
  LifeBuoy,
  ListChecks,
  Network,
  Scale,
  Server,
  Siren,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "How-To": ListChecks,
  Process: Workflow,
  Explanation: BookMarked,
  Reference: FileCode2,
  Policy: Scale,
  Decision: Gavel,
  Runbook: Siren,
  "Request Type": Inbox,
  Action: Zap,
  Theme: Layers,
  System: Server,
  "Source Document": FileText,
  "Graph Report": Network,
  Note: FileText,
  Support: LifeBuoy,
  Change: GitBranch,
};

interface TypeIconProps {
  type: string;
  size?: number;
  className?: string;
}

export function TypeIcon({ type, size = 16, className }: TypeIconProps) {
  const Icon = ICONS[type] ?? FileText;
  return <Icon size={size} className={className} aria-hidden />;
}
