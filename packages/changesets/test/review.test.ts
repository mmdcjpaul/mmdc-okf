import { describe, expect, it } from "vitest";
import { canApprove, decideReview } from "../src/index.ts";
import { draft, facts, issue, noteChange, PEOPLE, reviewer } from "./helpers.ts";

const codes = (d: ReturnType<typeof decideReview>) => d.reasons.map((r) => r.code);
const rules = (d: ReturnType<typeof decideReview>) => d.reasons.map((r) => r.rule);

describe("decideReview: writers publish directly", () => {
  it("a writer's edit in their namespace needs no review", () => {
    const d = decideReview(draft(), reviewer("alice"));
    expect(d).toEqual({ review: false, reasons: [], approverLevel: "write" });
  });

  it("whatever the change class", () => {
    for (const changeClass of ["fix", "addition", "process"] as const)
      expect(decideReview(draft({ changeClass }), reviewer("alice")).review).toBe(false);
  });

  it("a writer's new note needs no review", () => {
    const d = decideReview(
      draft({ facts: facts({ notes: [noteChange({ kind: "created", from: null })] }) }),
      reviewer("alice"),
    );
    expect(d.review).toBe(false);
  });

  it("a rename inside the namespace needs no review", () => {
    const d = decideReview(
      draft({
        facts: facts({
          notes: [
            noteChange({ kind: "moved", to: "kb/admissions/b.md", textChanged: false }),
            // A link in a finance note was rewritten by the move.
            noteChange({
              id: "kb_2",
              namespace: "finance",
              namespaceBefore: "finance",
              primary: false,
            }),
          ],
          namespaces: ["admissions"],
        }),
      }),
      reviewer("alice"),
    );
    expect(d.review).toBe(false);
  });

  it("an admin's edit anywhere needs no review", () => {
    const people = noteChange({ namespace: "people-ops", namespaceBefore: "people-ops" });
    expect(
      decideReview(draft({ facts: facts({ notes: [people] }) }), reviewer("dana")).review,
    ).toBe(false);
  });
});

describe("decideReview: PRD 7.3, one rule at a time", () => {
  it("rule 1: the submitter cannot write to the namespace (a reader's suggestion)", () => {
    const d = decideReview(draft({ source: "suggest" }), reviewer("carol"));
    expect(d.review).toBe(true);
    expect(rules(d)).toEqual([1]);
    expect(d.approverLevel).toBe("write");
  });

  it("rule 1: a writer suggesting in a namespace they only read", () => {
    const finance = noteChange({ namespace: "finance", namespaceBefore: "finance" });
    const d = decideReview(draft({ facts: facts({ notes: [finance] }) }), reviewer("alice"));
    expect(codes(d)).toEqual(["no-write-access"]);
    expect(d.reasons[0]!.message).toContain("finance");
  });

  it("rule 1: one unwritable namespace among several is enough", () => {
    const d = decideReview(
      draft({
        facts: facts({
          notes: [
            noteChange(),
            noteChange({ id: "kb_2", namespace: "finance", namespaceBefore: "finance" }),
          ],
        }),
      }),
      reviewer("alice"),
    );
    expect(codes(d)).toEqual(["no-write-access"]);
  });

  it("rule 1: a hub edit by someone who maintains nothing", () => {
    const hub = noteChange({
      hub: "theme",
      namespace: null,
      namespaceBefore: null,
      type: "Theme",
      typeBefore: "Theme",
    });
    const d = decideReview(
      draft({ facts: facts({ notes: [hub], touchesTaxonomy: true }) }),
      reviewer("alice"),
    );
    expect(codes(d)).toEqual(["no-write-access"]);
    expect(d.approverLevel).toBe("maintain");
    expect(
      decideReview(
        draft({ facts: facts({ notes: [hub], touchesTaxonomy: true }) }),
        reviewer("bob"),
      ).review,
    ).toBe(false);
  });

  it("rule 2: AI drafted it and the namespace publishes manually", () => {
    const d = decideReview(draft({ source: "upload", aiDrafted: true }), reviewer("alice"));
    expect(codes(d)).toEqual(["ai-manual-namespace"]);
  });

  it("rule 2: not in a namespace that publishes automatically", () => {
    const d = decideReview(
      draft({ source: "upload", aiDrafted: true }),
      reviewer("alice", { publishing: { admissions: "auto" } }),
    );
    expect(d.review).toBe(false);
  });

  it("rule 3: AI proposes a Process change", () => {
    const d = decideReview(
      draft({ source: "upload", aiDrafted: true, changeClass: "process" }),
      reviewer("alice", { publishing: { admissions: "auto" } }),
    );
    expect(codes(d)).toEqual(["ai-process-change"]);
  });

  it("rule 3: AI changes a note a person has verified", () => {
    const d = decideReview(
      draft({
        source: "capture",
        aiDrafted: true,
        facts: facts({ notes: [noteChange({ humanVerified: true })] }),
      }),
      reviewer("alice", { publishing: { admissions: "auto" } }),
    );
    expect(codes(d)).toEqual(["ai-changes-verified"]);
  });

  it("rule 3: does not apply to a person making the same change", () => {
    const d = decideReview(
      draft({
        changeClass: "process",
        facts: facts({ notes: [noteChange({ humanVerified: true })] }),
      }),
      reviewer("alice"),
    );
    expect(d.review).toBe(false);
  });

  it("rule 3: a new note from AI is not a Process change to anything", () => {
    const d = decideReview(
      draft({
        source: "upload",
        aiDrafted: true,
        changeClass: "process",
        facts: facts({ notes: [noteChange({ kind: "created", from: null })] }),
      }),
      reviewer("alice", { publishing: { admissions: "auto" } }),
    );
    expect(d.review).toBe(false);
  });

  it.each(["namespace", "theme", "system", "tag"] as const)("rule 4: a new %s", (kind) => {
    const d = decideReview(
      draft({
        facts: facts({
          terms: [{ kind, slug: "new-term", change: "added" }],
          touchesTaxonomy: true,
        }),
      }),
      reviewer("bob", {}),
    );
    expect(codes(d)).toContain("new-term");
    expect(d.approverLevel).toBe("maintain");
  });

  it("rule 5: a likely duplicate, and a contradiction", () => {
    const dup = decideReview(
      draft({
        duplicates: [
          { path: "kb/admissions/a.md", otherId: "kb_9", kind: "duplicate", score: 0.95 },
        ],
      }),
      reviewer("alice"),
    );
    expect(codes(dup)).toEqual(["likely-duplicate"]);
    const con = decideReview(
      draft({
        duplicates: [{ path: "kb/admissions/a.md", otherId: "kb_9", kind: "contradiction" }],
      }),
      reviewer("alice"),
    );
    expect(codes(con)).toEqual(["contradiction"]);
    expect(rules(con)).toEqual([5]);
  });

  it("rule 6: deleting a note", () => {
    const d = decideReview(
      draft({
        facts: facts({
          notes: [noteChange({ kind: "deleted", to: null, namespace: null, status: null })],
        }),
      }),
      reviewer("alice"),
    );
    expect(codes(d)).toEqual(["destructive"]);
    expect(d.approverLevel).toBe("maintain");
  });

  it("rule 6: deprecating a note", () => {
    const d = decideReview(
      draft({ facts: facts({ notes: [noteChange({ status: "deprecated" })] }) }),
      reviewer("alice"),
    );
    expect(codes(d)).toEqual(["destructive"]);
    expect(d.reasons[0]!.message).toContain("deprecates");
  });

  it("rule 6: editing a note that is already deprecated is not destructive", () => {
    const d = decideReview(
      draft({
        facts: facts({ notes: [noteChange({ status: "deprecated", statusBefore: "deprecated" })] }),
      }),
      reviewer("alice"),
    );
    expect(d.review).toBe(false);
  });

  it("rule 6: moving a note between namespaces", () => {
    const moved = noteChange({
      kind: "moved",
      to: "kb/finance/a.md",
      namespace: "finance",
      textChanged: false,
    });
    const d = decideReview(draft({ facts: facts({ notes: [moved] }) }), reviewer("dana"));
    expect(codes(d)).toEqual(["destructive"]);
    expect(d.reasons[0]!.message).toContain("from admissions to finance");
  });

  it("rule 6: merging terms", () => {
    const d = decideReview(
      draft({
        facts: facts({
          notes: [],
          terms: [{ kind: "tag", slug: "re-enrollment", change: "removed" }],
          touchesTaxonomy: true,
        }),
      }),
      reviewer("bob"),
    );
    expect(codes(d)).toEqual(["destructive"]);
  });

  it.each(["Action", "Request Type"])("rule 7: changing a %s note", (type) => {
    const d = decideReview(
      draft({ facts: facts({ notes: [noteChange({ type, typeBefore: type })] }) }),
      reviewer("alice"),
    );
    expect(codes(d)).toEqual(["action-or-request-type"]);
    expect(d.approverLevel).toBe("maintain");
  });

  it("rule 7: turning a note into an Action, or an Action into something else", () => {
    for (const n of [
      noteChange({ type: "Action", typeBefore: "How-To" }),
      noteChange({ type: "How-To", typeBefore: "Action" }),
      noteChange({ kind: "created", from: null, type: "Request Type", typeBefore: null }),
    ]) {
      expect(
        codes(decideReview(draft({ facts: facts({ notes: [n] }) }), reviewer("alice"))),
      ).toEqual(["action-or-request-type"]);
    }
  });

  it("rule 7: even for a maintainer, so there is a second pair of eyes", () => {
    const action = noteChange({
      type: "Action",
      typeBefore: "Action",
      namespace: "finance",
      namespaceBefore: "finance",
    });
    expect(decideReview(draft({ facts: facts({ notes: [action] }) }), reviewer("bob")).review).toBe(
      true,
    );
  });

  it("rule 8: validation problems the repair could not fix", () => {
    const d = decideReview(
      draft({
        source: "upload",
        aiDrafted: true,
        unrepaired: [issue(), issue({ rule: "lore/secrets" })],
      }),
      reviewer("alice", { publishing: { admissions: "auto" } }),
    );
    expect(codes(d)).toEqual(["validation"]);
    expect(d.reasons[0]!.message).toContain("2 validation problems");
  });
});

describe("decideReview: combinations", () => {
  it("an AI Process change to a verified note (plan example)", () => {
    const d = decideReview(
      draft({
        source: "capture",
        aiDrafted: true,
        changeClass: "process",
        facts: facts({ notes: [noteChange({ humanVerified: true })] }),
      }),
      reviewer("alice"),
    );
    expect(d.review).toBe(true);
    expect(codes(d)).toEqual(["ai-manual-namespace", "ai-process-change", "ai-changes-verified"]);
    expect(d.approverLevel).toBe("write");
  });

  it("a reader's upload that adds a tag and an Action needs a maintainer", () => {
    const d = decideReview(
      draft({
        source: "upload",
        aiDrafted: true,
        facts: facts({
          notes: [noteChange({ kind: "created", from: null, type: "Action", typeBefore: null })],
          terms: [{ kind: "tag", slug: "refunds-eu", change: "added" }],
          touchesTaxonomy: true,
        }),
      }),
      reviewer("carol"),
    );
    expect(rules(d)).toEqual([1, 2, 4, 7]);
    expect(d.approverLevel).toBe("maintain");
  });

  it("the approver level is write unless a maintainer-level rule fired", () => {
    const d = decideReview(
      draft({
        source: "suggest",
        duplicates: [{ path: "kb/admissions/a.md", otherId: "kb_9", kind: "duplicate" }],
      }),
      reviewer("carol"),
    );
    expect(rules(d)).toEqual([1, 5]);
    expect(d.approverLevel).toBe("write");
  });

  it("every reason carries its PRD rule number and a message", () => {
    const d = decideReview(
      draft({
        source: "upload",
        aiDrafted: true,
        changeClass: "process",
        unrepaired: [issue()],
        duplicates: [{ path: "kb/admissions/a.md", otherId: "kb_9", kind: "duplicate" }],
        facts: facts({
          notes: [
            noteChange({ humanVerified: true, type: "Action", typeBefore: "Action" }),
            noteChange({ id: "kb_2", kind: "deleted", to: null, namespace: null, status: null }),
          ],
          terms: [{ kind: "theme", slug: "new-theme", change: "added" }],
          touchesTaxonomy: true,
        }),
      }),
      reviewer("carol"),
    );
    expect(new Set(rules(d))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    for (const r of d.reasons) expect(r.message.length).toBeGreaterThan(10);
  });
});

describe("canApprove", () => {
  const cs = (over = {}) => ({
    namespaces: ["admissions"],
    approverLevel: "write" as const,
    submitterId: "carol",
    ...over,
  });
  const as = (id: keyof typeof PEOPLE) => ({ id, ...PEOPLE[id]! });

  it("writers in the namespace approve content", () => {
    expect(canApprove(cs(), as("alice"))).toBe(true);
    expect(canApprove(cs(), as("bob"))).toBe(false);
    expect(canApprove(cs(), as("dana"))).toBe(true);
  });

  it("only maintainers approve maintainer-level changes", () => {
    expect(canApprove(cs({ approverLevel: "maintain" }), as("alice"))).toBe(false);
    expect(canApprove(cs({ namespaces: ["finance"], approverLevel: "maintain" }), as("bob"))).toBe(
      true,
    );
  });

  it("needs the level on every namespace the changeset writes to", () => {
    expect(canApprove(cs({ namespaces: ["admissions", "finance"] }), as("alice"))).toBe(false);
    expect(canApprove(cs({ namespaces: ["admissions", "finance"] }), as("dana"))).toBe(true);
  });

  it("vocabulary changes need a maintainer of any namespace", () => {
    expect(canApprove(cs({ namespaces: [], approverLevel: "maintain" }), as("bob"))).toBe(true);
    expect(canApprove(cs({ namespaces: [], approverLevel: "maintain" }), as("alice"))).toBe(false);
  });

  it("nobody approves their own changeset, except an admin", () => {
    expect(canApprove(cs({ submitterId: "alice" }), as("alice"))).toBe(false);
    expect(canApprove(cs({ submitterId: "dana" }), as("dana"))).toBe(true);
  });
});
