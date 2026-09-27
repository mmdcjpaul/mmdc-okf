import { mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backlinks, getNote, listNotes, noteHistory, wantedNotes } from "@lore/db";
import { indexNames } from "@lore/search";
import { createHarness, dump, normalize, NOW, servicesAvailable, type Harness } from "./harness.ts";

const available = await servicesAvailable();
const ALL = { namespaces: ["admissions", "finance", "it-support", "people-ops"] };

describe.skipIf(!available)("index job against vault-acme", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness("indexer");
  });
  afterAll(async () => {
    await h?.close();
  });

  it("indexes the fixture: notes, hubs, trust, stale, wanted, and history", async () => {
    const r = await h.index();
    expect(r.skipped).toBe(false);
    // 48 notes and 8 hubs (fixtures/README.md); generated files are not notes.
    expect(r.notes).toBe(56);
    const scope = { vaultId: h.vaultId, ...ALL };
    const all = await listNotes(h.db, scope, { hubs: true, deprecated: true, limit: 1000 });
    expect(all).toHaveLength(56);
    expect(all.filter((n) => n.hubKind === "theme")).toHaveLength(4);
    expect(all.filter((n) => n.hubKind === "system")).toHaveLength(4);
    expect(all.some((n) => n.path.endsWith("/index.md") || n.path.includes("/_meta/"))).toBe(false);

    expect(all.find((n) => n.path.endsWith("manage-the-course-waitlist.md"))?.status).toBe("draft");
    expect(all.find((n) => n.path.endsWith("submit-a-paper-enrollment-form.md"))?.status).toBe(
      "deprecated",
    );
    expect(all.find((n) => n.path === "kb/_themes/enrollment.md")?.trustTier).toBe("human");
    expect(all.some((n) => n.trustTier === "unverified")).toBe(true);

    const wanted = await wantedNotes(h.db, scope);
    expect(wanted.map((w) => w.targetPath)).toContain("kb/it-support/unlock-a-locked-account.md");

    const enrollment = await listNotes(h.db, scope, { theme: "enrollment" });
    expect(enrollment.length).toBeGreaterThan(3);

    const reset = all.find((n) => n.path.endsWith("reset-a-staff-password.md"))!;
    const history = await noteHistory(h.db, h.vaultId, reset.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.changeClass).toBe("addition");
    const full = await getNote(h.db, scope, reset.id);
    expect(full?.lastChangedBy).toBe("Lore seed");
  });

  it("hub bodies omit the generated member list", async () => {
    const scope = { vaultId: h.vaultId, ...ALL };
    const hub = (await listNotes(h.db, scope, { hubs: true, limit: 1000 })).find(
      (n) => n.path === "kb/_themes/onboarding.md",
    )!;
    const note = await getNote(h.db, scope, hub.id);
    expect(note!.body).not.toContain("kb:members");
    // Members come from the notes' own `themes`, filtered by what the reader can see.
    const carolView = await listNotes(
      h.db,
      { vaultId: h.vaultId, namespaces: ["admissions", "finance", "it-support"] },
      { theme: "onboarding" },
    );
    expect(carolView.every((n) => n.namespace !== "people-ops")).toBe(true);
  });

  it("does nothing when the head has not moved", async () => {
    const r = await h.index();
    expect(r.skipped).toBe(true);
  });

  it("a commit that only touches generated files writes and embeds nothing", async () => {
    const file = join(h.work, "kb/it-support/index.md");
    await writeFile(file, (await readFile(file, "utf8")) + "\n");
    expect(await h.push("Regenerate indexes")).not.toBeNull();
    const r = await h.index();
    expect(r.skipped).toBe(false);
    expect(r.changed).toEqual([]);
    expect(r.embedded).toBe(0);
  });

  it("a rename pushed from outside keeps the note id", async () => {
    const scope = { vaultId: h.vaultId, ...ALL };
    const before = (await listNotes(h.db, scope, { limit: 1000 })).find((n) =>
      n.path.endsWith("set-up-a-campus-printer.md"),
    )!;
    await mkdir(join(h.work, "kb/it-support/devices"), { recursive: true });
    await rename(
      join(h.work, "kb/it-support/set-up-a-campus-printer.md"),
      join(h.work, "kb/it-support/devices/set-up-a-campus-printer.md"),
    );
    await h.push("Move printer how-to", { name: "Obsidian user", email: "obsidian@acme.test" });
    await h.index();
    const after = await getNote(h.db, scope, before.id);
    expect(after?.path).toBe("kb/it-support/devices/set-up-a-campus-printer.md");
    expect(after?.folder).toBe("devices");
    const history = await noteHistory(h.db, h.vaultId, before.id);
    expect(history.map((c) => c.authorName)).toEqual(["Obsidian user", "Lore seed"]);
  });

  it("a major version bump pushed from outside is a Process change", async () => {
    const scope = { vaultId: h.vaultId, ...ALL };
    const path = "kb/finance/month-end-close-process.md";
    const text = await readFile(join(h.work, path), "utf8");
    const m = /^version: (\d+)\.\d+\.\d+$/m.exec(text)!;
    await writeFile(
      join(h.work, path),
      text
        .replace(m[0], `version: ${Number(m[1]) + 1}.0.0`)
        .replace(/\n# /, "\nClose now starts on day 2.\n\n# "),
    );
    await h.push("Change the close process");
    const r = await h.index();
    const note = (await listNotes(h.db, scope, { limit: 1000 })).find((n) => n.path === path)!;
    expect(r.processChanged).toContain(note.id);
    expect(note.processChangedAt).not.toBeNull();
  });

  it("adding a wanted note resolves the links that wanted it", async () => {
    const scope = { vaultId: h.vaultId, ...ALL };
    const path = "kb/it-support/unlock-a-locked-account.md";
    await writeFile(
      join(h.work, path),
      [
        "---",
        "type: How-To",
        "title: Unlock a locked account",
        "description: Unlock a staff account after too many failed sign-ins.",
        "id: kb_01K0000000000000000000UNLK",
        "version: 1.0.0",
        "themes: [access-management]",
        "---",
        "",
        "# Steps",
        "",
        "1. Open the directory admin console.",
        "",
      ].join("\n"),
    );
    await h.push("Write the wanted unlock note");
    await h.index();
    expect((await wantedNotes(h.db, scope)).map((w) => w.targetPath)).not.toContain(path);
    const inbound = await backlinks(h.db, scope, "kb_01K0000000000000000000UNLK");
    expect(inbound.map((n) => n.path)).toContain("kb/it-support/reset-a-staff-password.md");
  });
});

describe.skipIf(!available)("staleness follows the clock, not commits", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness("staleness");
    await h.index();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("marks a note stale once its review date passes, with no new commit", async () => {
    const sql = h.db.$client;
    const [due] = await sql`
      select id, stale_after, health_score from notes
      where vault_id = ${h.vaultId} and stale_after > ${NOW.toISOString()}::timestamptz and not stale and hub_kind is null
      order by stale_after limit 1`;
    expect(due, "the fixture has a note with a future review date").toBeDefined();
    const names = indexNames(h.slug);
    const before = await h.meili.index(names.notes).getDocument(due!.id);
    expect(before.stale).toBe(false);

    h.clock.now = new Date(new Date(due!.stale_after).getTime() + 1000);
    const run = await h.index();
    expect(run.skipped).toBe(true); // nothing was pushed

    const [after] = await sql`
      select stale, health_score from notes where vault_id = ${h.vaultId} and id = ${due!.id}`;
    expect(after!.stale).toBe(true);
    expect(after!.health_score).toBe(Math.max(0, due!.health_score - 20));
    const doc = await h.meili.index(names.notes).getDocument(due!.id);
    expect(doc.stale).toBe(true);
    expect(doc.health).toBe(after!.health_score);
    const chunks = await h.meili
      .index(names.chunks)
      .getDocuments({ filter: `note_id = "${due!.id}"`, fields: ["stale"], limit: 100 });
    expect(chunks.results.length).toBeGreaterThan(0);
    expect(chunks.results.every((c) => c.stale === true)).toBe(true);
  });

  it("clears the flag when the clock is before the review date again", async () => {
    h.clock.now = NOW;
    await h.index();
    const [row] = await h.db.$client`
      select count(*)::int as n from notes
      where vault_id = ${h.vaultId} and stale and stale_after > ${NOW.toISOString()}::timestamptz`;
    expect(row!.n).toBe(0);
  });
});

describe.skipIf(!available)("incremental indexing equals a full rebuild", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness("incremental");
    await h.index();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("matches after 20 scripted commits", async () => {
    const edit = async (path: string, fn: (s: string) => string) => {
      const p = join(h.work, path);
      await writeFile(p, fn(await readFile(p, "utf8")));
    };
    const put = async (path: string, text: string) => {
      await mkdir(dirname(join(h.work, path)), { recursive: true });
      await writeFile(join(h.work, path), text);
    };
    const bump = (level: 0 | 1 | 2) => (s: string) =>
      s.replace(/^version: (\d+)\.(\d+)\.(\d+)$/m, (_m, a, b, c) =>
        level === 0
          ? `version: ${+a + 1}.0.0`
          : level === 1
            ? `version: ${a}.${+b + 1}.0`
            : `version: ${a}.${b}.${+c + 1}`,
      );
    const note = (id: string, title: string, body: string, extra = "") =>
      `---\ntype: How-To\ntitle: ${title}\ndescription: ${title}.\nid: ${id}\nversion: 1.0.0\nthemes: [onboarding]\n${extra}---\n\n${body}\n`;

    const steps: [string, () => Promise<void>][] = [
      [
        "fix a typo",
        () =>
          edit("kb/it-support/reset-a-staff-password.md", (s) =>
            bump(2)(s.replace("password", "passphrase")),
          ),
      ],
      [
        "add a section",
        () => edit("kb/finance/refund-policy.md", (s) => bump(1)(s + "\n## Exceptions\n\nNone.\n")),
      ],
      [
        "process change",
        () =>
          edit("kb/admissions/enroll-a-new-student.md", (s) =>
            bump(0)(s + "\nStep zero: check the waitlist.\n"),
          ),
      ],
      [
        "new note with a wanted link",
        () =>
          put(
            "kb/it-support/configure-vpn.md",
            note(
              "kb_01K00000000000000000000VPN",
              "Configure the VPN",
              "See [VPN troubleshooting](/it-support/troubleshoot-the-vpn.md).",
            ),
          ),
      ],
      [
        "write the wanted note",
        () =>
          put(
            "kb/it-support/troubleshoot-the-vpn.md",
            note("kb_01K000000000000000000VPNTS", "Troubleshoot the VPN", "Restart the client."),
          ),
      ],
      [
        "rename a linked note",
        () =>
          rename(
            join(h.work, "kb/it-support/troubleshoot-single-sign-on.md"),
            join(h.work, "kb/it-support/troubleshoot-sso.md"),
          ),
      ],
      ["delete a note", () => rm(join(h.work, "kb/it-support/set-up-a-campus-printer.md"))],
      [
        "retag a note",
        () =>
          edit("kb/finance/approve-vendor-invoices.md", (s) =>
            s.replace(/^tags: \[/m, "tags: [month-end, "),
          ),
      ],
      ["generated files only", () => edit("kb/index.md", (s) => s + "\n")],
      ["add an asset", () => put("kb/finance/_assets/close-calendar.png", "\x89PNG fake bytes")],
      [
        "link the asset",
        () =>
          edit(
            "kb/finance/month-end-close-process.md",
            (s) => s + "\n![Close calendar](/finance/_assets/close-calendar.png)\n",
          ),
      ],
      [
        "deprecate a note",
        () =>
          edit("kb/finance/close-accounts-payable.md", (s) =>
            s.replace(/^version:/m, "status: deprecated\nversion:"),
          ),
      ],
      [
        "edit a hub intro",
        () =>
          edit("kb/_themes/onboarding.md", (s) =>
            s.replace(/\n# /, "\nNew hires start here.\n\n# "),
          ),
      ],
      [
        "new namespace note",
        () =>
          put(
            "kb/people-ops/holiday-calendar.md",
            note("kb_01K000000000000000000HOLID", "Holiday calendar", "Ten holidays."),
          ),
      ],
      [
        "verify a note",
        () =>
          edit("kb/it-support/reset-a-staff-password.md", (s) =>
            s.replace(
              /^version:/m,
              "verified: [{ by: 'human:dana', at: 2026-09-20T00:00:00Z }]\nversion:",
            ),
          ),
      ],
      [
        "add a tag to the tag list",
        () =>
          edit(
            ".kb/tags.yaml",
            (s) => s + "\nvpn: { description: Remote access, aliases: [remote-access] }\n",
          ),
      ],
      [
        "move a folder",
        () => rename(join(h.work, "kb/finance/runbooks"), join(h.work, "kb/finance/operations")),
      ],
      ["delete the new note", () => rm(join(h.work, "kb/it-support/configure-vpn.md"))],
      [
        "stale a note",
        () =>
          edit("kb/it-support/it-support-hours-and-contacts.md", (s) =>
            s.replace(/^version:/m, "stale_after: 2026-01-01T00:00:00Z\nversion:"),
          ),
      ],
      [
        "second process change",
        () => edit("kb/admissions/enroll-a-new-student.md", (s) => bump(0)(s)),
      ],
    ];
    expect(steps).toHaveLength(20);
    for (const [message, step] of steps) {
      await step();
      expect(await h.push(message), message).not.toBeNull();
      await h.index();
    }
    // The rebuild runs a year later than the incremental runs, so review dates pass in between.
    h.clock.now = new Date(NOW.getTime() + 365 * 24 * 3600 * 1000);
    await h.index();
    const incremental = normalize(await dump(h));
    const r = await h.rebuild();
    expect(r.embedded).toBe(0); // every vector comes from the cache
    const full = normalize(await dump(h)) as Record<string, unknown[]>;
    const inc = incremental as Record<string, unknown[]>;
    // Compare table by table so a failure names the table that drifted.
    for (const key of Object.keys(full)) expect(full[key], key).toEqual(inc[key]);
  });
});
