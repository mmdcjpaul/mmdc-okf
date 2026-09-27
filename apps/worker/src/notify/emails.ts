/**
 * Emails what the app has already put in a person's notifications. One email per person
 * per run, however many notifications are waiting, so a busy day is not a flood.
 */
import { markEmailed, notificationsToEmail, type Db, type PendingEmail } from "@lore/db";
import type { Logger } from "pino";
import { escapeHtml, layout, type Mail, type Mailer } from "./mailer.ts";

export interface EmailDeps {
  db: Db;
  mailer: Mailer;
  log: Logger;
  publicUrl: string;
  now?: () => Date;
}

/** Notifications older than this are not emailed: by then the news is old. */
const WINDOW_MS = 24 * 3_600_000;

export function renderNotifications(items: PendingEmail[], publicUrl: string): Mail {
  const first = items[0]!;
  const link = (href: string | null) => `${publicUrl}${href ?? "/notifications"}`;
  const subject = items.length === 1 ? first.title : `${first.title}, and ${items.length - 1} more`;
  const text = [
    ...items.map((i) => [i.title, i.body, link(i.href)].filter(Boolean).join("\n")),
    `Change what is emailed to you: ${publicUrl}/notifications`,
  ].join("\n\n");
  const html = layout({
    heading: items.length === 1 ? first.title : `${items.length} things need your attention`,
    publicUrl,
    html: items
      .map(
        (i) =>
          `<p style="margin:0 0 14px"><a href="${escapeHtml(link(i.href))}" style="color:#1a56a8;font-weight:600;text-decoration:none">${escapeHtml(i.title)}</a>` +
          (i.body ? `<br><span style="color:#44443f">${escapeHtml(i.body)}</span>` : "") +
          `</p>`,
      )
      .join(""),
  });
  return { to: { name: first.name, email: first.email }, subject, text, html };
}

export async function sendNotificationEmails(deps: EmailDeps): Promise<number> {
  if (!deps.mailer.enabled) return 0;
  const now = deps.now?.() ?? new Date();
  const pending = await notificationsToEmail(deps.db, new Date(now.getTime() - WINDOW_MS));
  const byUser = new Map<string, PendingEmail[]>();
  for (const p of pending) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  let sent = 0;
  for (const items of byUser.values()) {
    try {
      await deps.mailer.send(renderNotifications(items, deps.publicUrl));
      // Marked only after the send, so a mail server that is down loses nothing.
      await markEmailed(
        deps.db,
        items.map((i) => i.id),
        now,
      );
      sent += 1;
    } catch (err) {
      deps.log.warn({ err, userId: items[0]!.userId }, "notification email not sent");
    }
  }
  return sent;
}
