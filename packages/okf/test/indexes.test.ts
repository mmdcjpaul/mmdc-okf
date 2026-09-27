import { describe, expect, it } from "vitest";
import { buildGraph, graphToJson } from "../src/graph.ts";
import { generateIndexes } from "../src/indexes.ts";
import { convertWikilinks, extractLinks, resolveLink } from "../src/links.ts";
import { parseNote } from "../src/note.ts";
import { MemorySource } from "../src/source.ts";
import { loadVault } from "../src/vault.ts";
import { acmeSource, NOW } from "./helpers.ts";

describe("generateIndexes", () => {
  it("matches the committed golden files in vault-acme", async () => {
    const ops = await generateIndexes(await loadVault(acmeSource()), { now: NOW });
    expect(ops.map((o) => o.path)).toEqual([]);
  });

  it("rebuilds deleted generated files and a second run yields no ops", async () => {
    const src = acmeSource();
    const stripped = new MemorySource(
      new Map(
        [...src.files].filter(
          ([p]) => !p.endsWith("/index.md") && p !== "kb/index.md" && !p.startsWith("kb/_meta/"),
        ),
      ),
    );
    const first = await generateIndexes(await loadVault(stripped), { now: NOW });
    const paths = first.map((o) => o.path);
    expect(paths).toContain("kb/index.md");
    expect(paths).toContain("kb/admissions/actions/index.md");
    expect(paths).toContain("kb/_meta/graph.json");
    const rebuilt = stripped.apply(first);
    for (const [path, content] of src.files)
      expect([path, rebuilt.files.get(path)]).toEqual([path, content]);
    expect(await generateIndexes(await loadVault(rebuilt), { now: NOW })).toEqual([]);
  });

  it("deletes index files in folders that no longer hold notes", async () => {
    const src = acmeSource();
    src.files.set("kb/admissions/empty/index.md", "# Empty\n");
    const vault = await loadVault(src);
    const ops = await generateIndexes(vault, { now: NOW });
    expect(ops).toEqual([{ op: "delete", path: "kb/admissions/empty/index.md" }]);
  });

  it("writes the root index with okf_version and counts", async () => {
    const src = acmeSource();
    const root = (await src.read("kb/index.md")) as string;
    expect(root.startsWith('---\nokf_version: "0.2"\n---\n')).toBe(true);
    expect(root).toContain(
      "* [Admissions](/admissions/index.md) - Applications, admission decisions, and student enrollment. (15 notes)",
    );
    expect(root).toContain("* [Enrollment](/_themes/enrollment.md)");
  });

  it("lists the known orphan, wanted note, stale note, and unverified note in the graph report", async () => {
    const report = (await acmeSource().read("kb/_meta/graph-report.md")) as string;
    const section = (name: string) => report.split(`# ${name}\n`)[1]!.split("\n# ")[0]!;
    expect(section("Orphans")).toContain(
      "[Set up a campus printer](/it-support/set-up-a-campus-printer.md)",
    );
    expect(section("Wanted notes")).toContain("`/it-support/unlock-a-locked-account.md`");
    expect(section("Stale notes")).toContain(
      "[Approve vendor invoices](/finance/approve-vendor-invoices.md)",
    );
    expect(section("Stale notes")).not.toContain("Submit a paper enrollment form");
    expect(section("Unverified notes")).toContain(
      "[How deposits flow from Salesforce to NetSuite]",
    );
    expect(report).toContain("- Trust: 43 human-reviewed, 1 machine-confirmed, 4 unverified.");
  });
});

describe("graph", () => {
  it("has a node per content note and typed edges", async () => {
    const vault = await loadVault(acmeSource());
    const json = graphToJson(vault, buildGraph(vault));
    expect(json.nodes.length).toBe(56);
    const returning = json.nodes.find(
      (n) => n.path === "/admissions/enroll-a-returning-student-in-salesforce.md",
    )!;
    expect(returning).toMatchObject({
      id: "kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D",
      type: "How-To",
      namespace: "admissions",
      themes: ["enrollment"],
      systems: ["salesforce", "sis"],
      trust: "human",
      status: "stable",
    });
    const kinds = (source: string) =>
      json.edges.filter((e) => e.source === source).map((e) => `${e.kind} ${e.target}`);
    expect(kinds(returning.path)).toEqual(
      expect.arrayContaining([
        "link /admissions/enroll-a-new-student.md",
        "member /_themes/enrollment.md",
        "member /_systems/sis.md",
        "source /admissions/references/sis-enrollment-sop-2025.md",
      ]),
    );
    expect(kinds("/admissions/submit-a-paper-enrollment-form.md")).toContain(
      "superseded_by /admissions/enroll-a-new-student.md",
    );
    expect(json.wanted).toEqual([
      {
        path: "/it-support/unlock-a-locked-account.md",
        from: ["/it-support/reset-a-staff-password.md"],
      },
    ]);
  });

  it("ignores links inside a hub's generated member list", async () => {
    const vault = await loadVault(acmeSource());
    const graph = buildGraph(vault);
    expect(graph.outDegree("/_themes/enrollment.md")).toBe(0);
  });
});

describe("resolveLink", () => {
  const from = "kb/admissions/actions/resend-enrollment-confirmation.md";
  it.each([
    ["/admissions/enroll-a-new-student.md", "kb/admissions/enroll-a-new-student.md", true, false],
    ["../enroll-a-new-student.md", "kb/admissions/enroll-a-new-student.md", true, false],
    ["./../../finance/refund-policy.md", "kb/finance/refund-policy.md", true, false],
    [
      "/admissions/enroll-a-new-student.md#steps",
      "kb/admissions/enroll-a-new-student.md",
      true,
      false,
    ],
    ["/admissions/does-not-exist.md", "kb/admissions/does-not-exist.md", false, true],
    ["/admissions/", "kb/admissions/index.md", true, false],
    ["../", "kb/admissions/index.md", true, false],
    ["/Admissions%20Folder/x.md", "kb/Admissions Folder/x.md", false, true],
  ])("%s", async (href, path, exists, wanted) => {
    const vault = await loadVault(acmeSource());
    const r = resolveLink(vault, from, href);
    expect(r.path).toBe(path);
    expect(r.exists).toBe(exists);
    expect(r.wanted).toBe(wanted);
  });

  it("keeps anchors, returns ids, and marks external links", async () => {
    const vault = await loadVault(acmeSource());
    const r = resolveLink(
      vault,
      from,
      "/admissions/enroll-a-returning-student-in-salesforce.md#steps",
    );
    expect(r.anchor).toBe("steps");
    expect(r.targetId).toBe("kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D");
    expect(resolveLink(vault, from, "https://example.com").external).toBe(true);
    expect(resolveLink(vault, from, "mailto:a@b.c").external).toBe(true);
    expect(resolveLink(vault, from, "../../../README.md").outside).toBe(true);
  });

  it("ignores links in code spans and code blocks", () => {
    const note = parseNote(
      "---\ntype: How-To\n---\n\n[real](/a.md) `[not](/b.md)` [[Wiki]]\n\n```\n[not](/c.md) [[NotWiki]]\n```\n\n[ref]: /d.md\n",
      "kb/ns/x.md",
    );
    expect(extractLinks(note).map((l) => `${l.kind}:${l.href}`)).toEqual([
      "link:/a.md",
      "wikilink:Wiki",
      "definition:/d.md",
    ]);
  });

  it("converts wikilinks by title and alias, in the profile's link style", async () => {
    const src = acmeSource();
    src.files.set(
      "kb/admissions/wiki.md",
      "---\ntype: How-To\ntitle: Wiki\n---\n\nSee [[Enroll a new student]], [[re-enroll a student|returning]], and [[Nothing here]].\n",
    );
    const vault = await loadVault(src);
    expect(convertWikilinks(vault, vault.notes.get("kb/admissions/wiki.md")!)).toContain(
      "See [Enroll a new student](/admissions/enroll-a-new-student.md), [returning](/admissions/enroll-a-returning-student-in-salesforce.md), and [Nothing here](/admissions/nothing-here.md).",
    );
    src.files.set(
      ".kb/profile.yaml",
      ((await src.read(".kb/profile.yaml")) as string).replace(
        "link_style: absolute",
        "link_style: relative",
      ),
    );
    const relative = await loadVault(src);
    expect(convertWikilinks(relative, relative.notes.get("kb/admissions/wiki.md")!)).toContain(
      "[Enroll a new student](./enroll-a-new-student.md)",
    );
  });
});
