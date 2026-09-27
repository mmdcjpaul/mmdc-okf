import type { ChangesetRow } from "@lore/db";

export const STATE_LABEL: Record<ChangesetRow["state"], { label: string; tone: string }> = {
  draft: { label: "Needs fixing", tone: "bg-bad-soft text-bad" },
  submitted: { label: "Processing", tone: "bg-line-2 text-muted" },
  committing: { label: "Processing", tone: "bg-line-2 text-muted" },
  in_review: { label: "In review", tone: "bg-info-soft text-info" },
  changes_requested: { label: "Changes requested", tone: "bg-warn-soft text-warn" },
  approved: { label: "Approved", tone: "bg-ok-soft text-ok" },
  committed: { label: "Published", tone: "bg-ok-soft text-ok" },
  conflicted: { label: "Needs merging", tone: "bg-warn-soft text-warn" },
  rejected: { label: "Not published", tone: "bg-line-2 text-muted" },
};

export function StateBadge({ state }: { state: ChangesetRow["state"] }) {
  const s = STATE_LABEL[state];
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11.5px] font-medium ${s.tone}`}
    >
      {s.label}
    </span>
  );
}
