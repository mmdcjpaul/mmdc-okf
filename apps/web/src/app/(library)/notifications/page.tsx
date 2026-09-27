import type { Metadata } from "next";
import Link from "next/link";
import { listNotifications } from "@lore/db";
import { EmptyState } from "@lore/ui";
import { MarkAllRead } from "@/components/MarkAllRead";
import { PageHeader } from "@/components/PageHeader";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { vault, principal } = await requireContext();
  const items = await listNotifications(db(), principal.user.id, vault.id, { limit: 100 });
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-[760px] px-5 pb-16 pt-10 md:px-10">
      <PageHeader
        title="Notifications"
        actions={unread ? <MarkAllRead /> : null}
        description={unread ? `${unread} unread.` : undefined}
      />
      {items.length === 0 ? (
        <EmptyState title="Nothing yet">
          Review requests, decisions on your changes, and process changes in notes your team owns
          will be listed here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line-2 rounded-lg border border-line">
          {items.map((n) => {
            const body = (
              <>
                <span className="flex items-baseline gap-2">
                  {n.readAt ? null : (
                    <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
                  )}
                  <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">{n.title}</span>
                  <span className="shrink-0 text-[12px] text-muted">{timeAgo(n.createdAt)}</span>
                </span>
                {n.body ? (
                  <span className="mt-0.5 block text-[13px] text-ink-2">{n.body}</span>
                ) : null}
              </>
            );
            return (
              <li key={n.id}>
                {n.href ? (
                  <Link href={n.href} className="block px-4 py-3 hover:bg-bg">
                    {body}
                  </Link>
                ) : (
                  <div className="px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
