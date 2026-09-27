/**
 * The weekly owner digest (PRD 8.2, LB-9): the stale, reported, and unverified notes a
 * person's teams own, notes that link to a process that changed, reviews that have waited
 * more than five working days, and knowledge gaps. Nothing is sent when there is nothing
 * to say.
 */
import { loadPrincipal, readScope, type Principal } from "@lore/auth";
import { canApprove } from "@lore/changesets";
import {
  getPrefs,
  hygieneNotes,
  listChangesets,
  listUsers,
  listVaults,
  setPrefs,
  type ChangesetRow,
  type Db,
  type HygieneNote,
  type Vault,
} from "@lore/db";
import type { Logger } from "pino";
import { NO_GAPS, type GapSource, type KnowledgeGap } from "./gaps.ts";
import { escapeHtml, layout, type Mail, type Mailer } from "./mailer.ts";

export interface DigestDeps {
  db: Db;
  mailer: Mailer;
  log: Logger;
  publicUrl: string;
  gaps?: GapSource;
  now?: () => Date;
}

export interface Digest {
  stale: HygieneNote[];
  reported: HygieneNote[];
  unverified: HygieneNote[];
  flagged: HygieneNote[];
  reviews: ChangesetRow[];
  gaps: KnowledgeGap[];
}

const PER_SECTION = 15;
/** A digest is weekly: nobody gets a second one within six days, whatever restarts. */
const MIN_GAP_MS = 6 * 24 * 3_600_000;

/** The date `days` working days before `now`, counting Monday to Friday. */
export function workingDaysBefore(now: Date, days: number): Date {
  const d = new Date(now);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

export async function buildDigest(
  db: Db,
  p: Principal,
  now: Date,
  gaps: GapSource = NO_GAPS,
): Promise<Digest | null> {
  const scope = readScope(p);
  const own = { ownerTeams: p.teamIds, limit: PER_SECTION };
  const [stale, reported, unverified, flagged] = p.teamIds.length
    ? await Promise.all([
        hygieneNotes(db, scope, { ...own, problem: "stale" }),
        hygieneNotes(db, scope, { ...own, problem: "reported" }),
        hygieneNotes(db, scope, { ...own, problem: "unverified" }),
        hygieneNotes(db, scope, { ...own, problem: "flagged" }),
      ])
    : [[], [], [], []];
  const late = workingDaysBefore(now, 5);
  const reviewer = { id: p.user.id, access: p.access, isAdmin: p.isAdmin };
  const reviews = (await listChangesets(db, { vaultId: p.vaultId, states: ["in_review"] }))
    .filter((cs) => (cs.submittedAt ?? cs.createdAt) <= late)
    .filter((cs) =>
      canApprove(
        {
          namespaces: cs.namespaces,
          approverLevel: cs.approverLevel ?? "write",
          submitterId: cs.submitterId,
        },
        reviewer,
      ),
    )
    .slice(0, PER_SECTION);
  // Gaps go to the people who maintain a namespace: they decide what gets written.
  const maintained = [...p.access].filter(([, l]) => l === "maintain").map(([ns]) => ns);
  const found = maintained.length
    ? await gaps.gaps({
        vaultId: p.vaultId,
        namespaces: maintained,
        since: new Date(now.getTime() - 7 * 24 * 3_600_000),
        limit: PER_SECTION,
      })
    : [];
  const digest = { stale, reported, unverified, flagged, reviews, gaps: found };
  return Object.values(digest).some((list) => list.length) ? digest : null;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Section {
  title: string;
  items: { label: string; detail: string; href: string }[];
  more: string;
}

function sections(d: Digest): Section[] {
  const note = (n: HygieneNote, detail: string) => ({
    label: n.title,
    detail: [n.namespace, detail].filter(Boolean).join(" · "),
    href: `/n/${encodeURIComponent(n.id)}/${n.slug}`,
  });
  const all: Section[] = [
    {
      title: "Review due",
      items: d.stale.map((n) => note(n, `due ${day(n.staleAfter)}`)),
      more: "/hygiene?mine=1&problem=stale",
    },
    {
      title: "Reported by readers",
      items: d.reported.map((n) => note(n, count(n.openReports, "open report", "open reports"))),
      more: "/hygiene?mine=1&problem=reported",
    },
    {
      title: "Never verified",
      items: d.unverified.map((n) => note(n, n.type)),
      more: "/hygiene?mine=1&problem=unverified",
    },
    {
      title: "Link to a process that changed",
      items: d.flagged.map((n) => note(n, "may need updating too")),
      more: "/hygiene?mine=1&problem=flagged",
    },
    {
      title: "Waiting for review more than 5 working days",
      items: d.reviews.map((cs) => ({
        label: cs.title,
        detail: [cs.namespaces.join(", "), `since ${day(cs.submittedAt ?? cs.createdAt)}`]
          .filter(Boolean)
          .join(" · "),
        href: `/changes/${cs.id}`,
      })),
      more: "/review",
    },
    {
      title: "Questions that found nothing",
      items: d.gaps.map((g) => ({
        label: g.question,
        detail: [g.namespace, `asked ${count(g.count, "time", "times")}`]
          .filter(Boolean)
          .join(" · "),
        href: "/hygiene",
      })),
      more: "/hygiene",
    },
  ];
  return all.filter((s) => s.items.length);
}

export function renderDigest(
  d: Digest,
  to: { name: string; email: string },
  vault: Vault,
  publicUrl: string,
): Mail {
  const parts = sections(d);
  const total = parts.reduce((n, s) => n + s.items.length, 0);
  const subject = `${vault.title}: ${count(total, "thing needs", "things need")} your attention this week`;
  const text = [
    ...parts.map((s) =>
      [
        s.title,
        ...s.items.map((i) => `- ${i.label} (${i.detail})\n  ${publicUrl}${i.href}`),
        ...(s.items.length === PER_SECTION ? [`  More: ${publicUrl}${s.more}`] : []),
      ].join("\n"),
    ),
    `Change what is emailed to you: ${publicUrl}/notifications`,
  ].join("\n\n");
  const html = layout({
    heading: `Your week in ${vault.title}`,
    publicUrl,
    html: parts
      .map(
        (s) =>
          `<h2 style="font-size:15px;margin:20px 0 6px">${escapeHtml(s.title)}</h2>` +
          `<ul style="margin:0;padding-left:20px">` +
          s.items
            .map(
              (i) =>
                `<li style="margin:0 0 4px"><a href="${escapeHtml(publicUrl + i.href)}" style="color:#1a56a8;text-decoration:none">${escapeHtml(i.label)}</a> <span style="color:#6b6b66;font-size:13px">${escapeHtml(i.detail)}</span></li>`,
            )
            .join("") +
          `</ul>` +
          (s.items.length === PER_SECTION
            ? `<p style="margin:4px 0 0;font-size:13px"><a href="${escapeHtml(publicUrl + s.more)}" style="color:#1a56a8">See all</a></p>`
            : ""),
      )
      .join(""),
  });
  return { to, subject, text, html };
}

export interface DigestRun {
  sent: number;
  /** People with nothing to be told. */
  empty: number;
  skipped: number;
  failed: number;
}

/** Sends this week's digest to everyone who has something in it. Safe to run twice. */
export async function sendDigests(
  deps: DigestDeps,
  opts: { vaultId?: string; userId?: string; force?: boolean } = {},
): Promise<DigestRun> {
  const run: DigestRun = { sent: 0, empty: 0, skipped: 0, failed: 0 };
  if (!deps.mailer.enabled) return run;
  const now = deps.now?.() ?? new Date();
  const vaults = (await listVaults(deps.db)).filter((v) => !opts.vaultId || v.id === opts.vaultId);
  const people = (await listUsers(deps.db)).filter(
    (u) => !u.serviceAccount && (!opts.userId || u.id === opts.userId),
  );
  for (const user of people) {
    const prefs = await getPrefs(deps.db, user.id);
    const recent = prefs.digestSentAt && now.getTime() - prefs.digestSentAt.getTime() < MIN_GAP_MS;
    if (!prefs.emailDigest || (recent && !opts.force)) {
      run.skipped += 1;
      continue;
    }
    let sent = false;
    for (const vault of vaults) {
      const principal = await loadPrincipal(deps.db, vault.id, user.id);
      if (!principal) continue;
      const digest = await buildDigest(deps.db, principal, now, deps.gaps);
      if (!digest) continue;
      try {
        await deps.mailer.send(renderDigest(digest, user, vault, deps.publicUrl));
        sent = true;
      } catch (err) {
        run.failed += 1;
        deps.log.warn({ err, userId: user.id }, "digest not sent");
      }
    }
    if (sent) {
      await setPrefs(deps.db, user.id, { digestSentAt: now });
      run.sent += 1;
    } else run.empty += 1;
  }
  return run;
}
