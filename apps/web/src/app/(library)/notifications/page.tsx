import type { Metadata } from "next";
import Link from "next/link";
import { getPrefs, listFollows, listNotifications, listTerms, notesByIds } from "@lore/db";
import { EmptyState } from "@lore/ui";
import { EmailPrefs } from "@/components/EmailPrefs";
import { FollowButton } from "@/components/FollowButton";
import { MarkAllRead } from "@/components/MarkAllRead";
import { PageHeader } from "@/components/PageHeader";
import { requireContext } from "@/lib/context";
import { db } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import { noteHref, termHref } from "@/lib/urls";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { vault, principal, scope } = await requireContext();
  const [items, prefs, follows, terms] = await Promise.all([
    listNotifications(db(), principal.user.id, vault.id, { limit: 100 }),
    getPrefs(db(), principal.user.id),
    listFollows(db(), principal.user.id, vault.id),
    listTerms(db(), vault.id),
  ]);
  // Only what the person can still read is named. The rest can be unfollowed, unnamed.
  const notes = new Map(
    (
      await notesByIds(
        db(),
        scope,
        follows.map((f) => f.target).filter((t) => !t.includes(":")),
      )
    ).map((n) => [n.id, n]),
  );
  const following = follows.map((f) => {
    const hub = /^(theme|system):(.+)$/.exec(f.target);
    if (hub) {
      const term = terms.find((t) => t.kind === hub[1] && t.slug === hub[2]);
      return {
        target: f.target,
        title: term?.title ?? hub[2]!,
        kind: hub[1] === "theme" ? "Theme" : "System",
        href: termHref(hub[1] as "theme" | "system", hub[2]!),
      };
    }
    const note = notes.get(f.target);
    return note
      ? { target: f.target, title: note.title, kind: note.type, href: noteHref(note) }
      : { target: f.target, title: "A note you can no longer read", kind: "", href: null };
  });
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

      <section aria-label="Following" className="mt-10">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">Following</h2>
        {following.length === 0 ? (
          <p className="text-[13.5px] text-muted">
            Choose Follow on a note, a theme, or a system to be told when its process changes.
          </p>
        ) : (
          <ul className="divide-y divide-line-2 rounded-lg border border-line">
            {following.map((f) => (
              <li key={f.target} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 text-[14px]">
                  {f.href ? (
                    <Link href={f.href} className="font-medium text-ink hover:underline">
                      {f.title}
                    </Link>
                  ) : (
                    <span className="text-muted">{f.title}</span>
                  )}
                  {f.kind ? <span className="ml-2 text-[12.5px] text-muted">{f.kind}</span> : null}
                </span>
                <FollowButton target={f.target} following name={f.title} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Email" className="mt-10">
        <EmailPrefs
          email={principal.user.email}
          notifications={prefs.emailNotifications}
          digest={prefs.emailDigest}
        />
      </section>
    </div>
  );
}
