import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPrincipal } from "@lore/auth";
import { newRecordId } from "@lore/changesets";
import {
  follow,
  getPrefs,
  listNotifications,
  notify,
  recordFeedback,
  setPrefs,
  unfollow,
} from "@lore/db";
import { buildDigest, sendDigests, workingDaysBefore } from "../src/notify/digest.ts";
import { sendNotificationEmails } from "../src/notify/emails.ts";
import type { GapSource } from "../src/notify/gaps.ts";
import { MemoryMailer, SmtpMailer } from "../src/notify/mailer.ts";
import { createHarness, NOW, servicesAvailable, type Harness } from "./harness.ts";

await servicesAvailable();

const MAILPIT = process.env.TEST_MAILPIT_URL ?? "http://127.0.0.1:8025";
const SMTP = process.env.TEST_SMTP_URL ?? "smtp://127.0.0.1:1025";
const PUBLIC = "https://lore.acme.test";

async function mailpit<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${MAILPIT}/api/v1/${path}`, {
    ...init,
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    throw new Error(`Mailpit (${MAILPIT}) is not reachable. Run \`pnpm services:up\`.`);
  });
  if (!res.ok) throw new Error(`Mailpit answered ${res.status} for ${path}`);
  return (res.headers.get("content-type") ?? "").includes("json")
    ? ((await res.json()) as T)
    : (undefined as T);
}

interface Summary {
  ID: string;
  Subject: string;
  To: { Name: string; Address: string }[];
}
interface Message extends Summary {
  Text: string;
  HTML: string;
}

describe("notifications by email and the weekly digest", () => {
  let h: Harness;
  let mailer: MemoryMailer;
  const deps = () => ({
    db: h.db,
    mailer,
    log: h.deps.log,
    publicUrl: PUBLIC,
    now: () => h.clock.now,
  });
  const idOf = async (path: string) =>
    (await h.db.$client`select id from notes where vault_id = ${h.vaultId} and path = ${path}`)[0]!
      .id as string;

  beforeAll(async () => {
    h = await createHarness("notify");
    await h.index();
    await recordFeedback(h.db, {
      id: newRecordId("fb", NOW),
      vaultId: h.vaultId,
      noteId: await idOf("kb/finance/refund-policy.md"),
      userId: "carol",
      kind: "report",
      reason: "outdated",
      comment: "The window changed.",
      now: NOW,
    });
  });
  afterAll(() => h?.close());

  it("counts working days", () => {
    // Thursday 24 September 2026, back five working days, is Thursday 17 September.
    expect(workingDaysBefore(NOW, 5).toISOString().slice(0, 10)).toBe("2026-09-17");
    expect(workingDaysBefore(new Date("2026-09-28T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe(
      "2026-09-25",
    );
  });

  it("the digest holds what a person's teams own, and nothing else", async () => {
    const bob = (await buildDigest(h.db, (await loadPrincipal(h.db, h.vaultId, "bob"))!, NOW))!;
    expect(bob.stale.map((n) => n.title)).toEqual(["Approve vendor invoices"]);
    expect(bob.reported.map((n) => n.title)).toEqual(["Refund policy"]);
    expect(bob.unverified.map((n) => n.title)).toEqual([
      "How deposits flow from Salesforce to NetSuite",
    ]);
    const alice = (await buildDigest(h.db, (await loadPrincipal(h.db, h.vaultId, "alice"))!, NOW))!;
    expect(
      Object.values(alice)
        .flat()
        .map((n) => ("namespace" in n ? n.namespace : null)),
    ).toEqual(["admissions"]);
    // Carol owns nothing, so there is nothing to tell her.
    expect(
      await buildDigest(h.db, (await loadPrincipal(h.db, h.vaultId, "carol"))!, NOW),
    ).toBeNull();
  });

  it("knowledge gaps go to the people who maintain the namespace", async () => {
    const asked: string[][] = [];
    const gaps: GapSource = {
      async gaps(q) {
        asked.push(q.namespaces);
        return [
          {
            question: "How do I refund a deposit paid by cheque?",
            count: 4,
            namespace: "finance",
            lastAskedAt: NOW,
          },
        ];
      },
    };
    const bob = await buildDigest(h.db, (await loadPrincipal(h.db, h.vaultId, "bob"))!, NOW, gaps);
    expect(bob?.gaps).toHaveLength(1);
    expect(asked).toEqual([["finance"]]);
    const alice = await buildDigest(
      h.db,
      (await loadPrincipal(h.db, h.vaultId, "alice"))!,
      NOW,
      gaps,
    );
    expect(alice?.gaps).toEqual([]);
  });

  it("a review that has waited more than five working days is in the approver's digest", async () => {
    const { cs } = await h.submit({
      by: "carol",
      source: "suggest",
      reason: "The form moved.",
      edit: { "kb/finance/refund-policy.md": (t) => t + "\nThe form moved to the portal.\n" },
    });
    expect(cs.state).toBe("in_review");
    const bob = (await loadPrincipal(h.db, h.vaultId, "bob"))!;
    expect((await buildDigest(h.db, bob, NOW))!.reviews).toEqual([]);
    const later = new Date("2026-10-02T00:00:00Z");
    expect((await buildDigest(h.db, bob, later))!.reviews.map((r) => r.id)).toEqual([cs.id]);
    // Alice cannot approve changes to finance, so it is not hers to chase.
    const alice = (await loadPrincipal(h.db, h.vaultId, "alice"))!;
    expect((await buildDigest(h.db, alice, later))!.reviews).toEqual([]);
  });

  it("is sent once a week, to people who want it", async () => {
    mailer = new MemoryMailer();
    await setPrefs(h.db, "alice", { emailDigest: false });
    expect(await sendDigests(deps())).toEqual({ sent: 1, empty: 3, skipped: 1, failed: 0 });
    expect(mailer.sent.map((m) => m.to.email)).toEqual(["bob@acme.test"]);
    expect((await getPrefs(h.db, "bob")).digestSentAt).toEqual(NOW);

    expect((await sendDigests(deps())).sent).toBe(0);
    h.clock.now = new Date(NOW.getTime() + 7 * 24 * 3_600_000);
    mailer.sent.length = 0;
    const next = await sendDigests(deps());
    h.clock.now = NOW;
    // By now the suggestion has waited long enough to reach Dana, who can approve it.
    expect(mailer.sent.map((m) => m.to.email).sort()).toEqual(["bob@acme.test", "dana@acme.test"]);
    expect(next.sent).toBe(2);
    await setPrefs(h.db, "alice", { emailDigest: true });
  });

  it("a mail server that is down loses nothing", async () => {
    mailer = new MemoryMailer();
    mailer.failing = true;
    await setPrefs(h.db, "bob", { digestSentAt: null });
    expect(await sendDigests(deps(), { userId: "bob" })).toMatchObject({ sent: 0, failed: 1 });
    expect((await getPrefs(h.db, "bob")).digestSentAt).toBeNull();
    mailer.failing = false;
    expect((await sendDigests(deps(), { userId: "bob" })).sent).toBe(1);
  });

  it("arrives in Mailpit listing the owner's stale, reported, and unverified notes", async () => {
    const run = `run${Date.now()}`;
    const smtp = new SmtpMailer(SMTP, `Lore <${run}@lore.test>`);
    await sendDigests({ ...deps(), mailer: smtp }, { userId: "bob", force: true });
    await smtp.close();
    const found = await mailpit<{ messages: Summary[] }>(
      `search?query=${encodeURIComponent(`from:${run}@lore.test`)}`,
    );
    expect(found.messages).toHaveLength(1);
    const mail = await mailpit<Message>(`message/${found.messages[0]!.ID}`);
    expect(mail.To).toEqual([{ Name: "Bob Chan", Address: "bob@acme.test" }]);
    expect(mail.Subject).toMatch(/^Acme: \d+ things need your attention this week$/);
    for (const body of [mail.Text, mail.HTML]) {
      expect(body).toContain("Review due");
      expect(body).toContain("Approve vendor invoices");
      expect(body).toContain("Reported by readers");
      expect(body).toContain("Refund policy");
      expect(body).toContain("Never verified");
      expect(body).toContain("How deposits flow from Salesforce to NetSuite");
      expect(body).toContain(`${PUBLIC}/n/`);
      // Nothing from a namespace Bob's team does not own.
      expect(body).not.toContain("Manage the course waitlist");
    }
    await mailpit(`messages`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: [found.messages[0]!.ID] }),
    });
  });

  it("emails unread notifications once, one email per person", async () => {
    mailer = new MemoryMailer();
    await h.db.$client`update notifications set emailed_at = now() where emailed_at is null`;
    await notify(h.db, [
      {
        userId: "bob",
        vaultId: h.vaultId,
        kind: "report",
        title: "Refund policy was reported",
        body: "As outdated.",
        href: "/n/x/refund-policy",
      },
      {
        userId: "bob",
        vaultId: h.vaultId,
        kind: "review",
        title: "A change needs your review",
        href: "/changes/cs_1",
      },
      { userId: "alice", vaultId: h.vaultId, kind: "review", title: "<b>Waitlist</b> changed" },
      { userId: "svc-multica", vaultId: h.vaultId, kind: "review", title: "For a service account" },
    ]);
    await setPrefs(h.db, "alice", { emailNotifications: true });
    expect(await sendNotificationEmails(deps())).toBe(2);
    const bob = mailer.sent.find((m) => m.to.email === "bob@acme.test")!;
    expect(bob.subject).toBe("Refund policy was reported, and 1 more");
    expect(bob.text).toContain(`${PUBLIC}/changes/cs_1`);
    const alice = mailer.sent.find((m) => m.to.email === "alice@acme.test")!;
    expect(alice.html).toContain("&lt;b&gt;Waitlist&lt;/b&gt; changed");
    expect(alice.html).not.toContain("<b>Waitlist");
    expect(await sendNotificationEmails(deps())).toBe(0);
    expect((await listNotifications(h.db, "bob", h.vaultId)).every((n) => n.emailedAt)).toBe(true);
  });

  it("does not email people who turned it off, or what they have already read", async () => {
    mailer = new MemoryMailer();
    await setPrefs(h.db, "alice", { emailNotifications: false });
    await notify(h.db, [
      { userId: "alice", vaultId: h.vaultId, kind: "review", title: "Not wanted by email" },
      { userId: "bob", vaultId: h.vaultId, kind: "review", title: "Already read" },
      { userId: "carol", vaultId: h.vaultId, kind: "review", title: "Too old" },
    ]);
    await h.db.$client`update notifications set read_at = now() where title = 'Already read'`;
    await h.db.$client`
      update notifications set created_at = now() - interval '2 days' where title = 'Too old'`;
    expect(await sendNotificationEmails({ ...deps(), now: () => new Date() })).toBe(0);
    expect(mailer.sent).toEqual([]);
  });

  it("following a hub tells you when a note under it has a process change", async () => {
    const before = (await listNotifications(h.db, "erin", h.vaultId)).length;
    await follow(h.db, "erin", h.vaultId, "theme:month-end-close");
    await follow(h.db, "carol", h.vaultId, "theme:month-end-close");
    await unfollow(h.db, "carol", h.vaultId, "theme:month-end-close");
    const path = (
      await h.db.$client`
        select path from notes where vault_id = ${h.vaultId} and namespace = 'finance'
          and 'month-end-close' = any(themes) and hub_kind is null and status = 'stable'
        order by path limit 1`
    )[0]!.path as string;
    const { outcome } = await h.submit({
      by: "bob",
      changeClass: "process",
      summary: "The close now starts a day earlier.",
      edit: { [path]: (t) => t + "\nThe close now starts a day earlier.\n" },
    });
    expect(outcome.state).toBe("committed");
    await h.indexWithEffects();
    const erin = await listNotifications(h.db, "erin", h.vaultId);
    expect(erin).toHaveLength(before + 1);
    expect(erin[0]).toMatchObject({ kind: "process_change" });
    expect(erin[0]!.body).toContain("hub you follow");
    expect(
      (await listNotifications(h.db, "carol", h.vaultId)).filter(
        (n) => n.kind === "process_change",
      ),
    ).toEqual([]);
  });
});
