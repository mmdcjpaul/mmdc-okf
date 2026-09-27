import { describe, expect, it } from "vitest";
import { decideTerm, proposedTerms, TermDecisionError, vocabularyDecided } from "../src/terms.ts";
import type { ChangesetIntent } from "../src/types.ts";

const intents: ChangesetIntent[] = [
  { type: "add_term", kind: "tag", slug: "cheque-refunds", description: "Refunds paid by cheque" },
  { type: "add_term", kind: "theme", slug: "collections", description: "Chasing unpaid fees" },
  {
    type: "create",
    namespace: "finance",
    data: {
      title: "Refund a deposit paid by cheque",
      themes: ["collections"],
      tags: ["refunds", "cheque-refunds"],
    },
    body: "# Steps\n",
  },
  {
    type: "create",
    namespace: "finance",
    data: { title: "Chase an unpaid fee", themes: ["collections", "month-end-close"], tags: [] },
    body: "# Steps\n",
  },
  { type: "edit", path: "kb/finance/refund-policy.md", set: { tags: ["cheque-refunds"] } },
  { type: "edit", path: "kb/finance/other.md", body: "unchanged" },
];

const TAG = { kind: "tag", slug: "cheque-refunds" } as const;
const THEME = { kind: "theme", slug: "collections" } as const;

describe("proposedTerms", () => {
  it("lists each proposal with the notes that use it", () => {
    expect(proposedTerms(intents)).toEqual([
      {
        ...TAG,
        description: "Refunds paid by cheque",
        acceptedBy: null,
        usedBy: ["Refund a deposit paid by cheque", "kb/finance/refund-policy.md"],
      },
      {
        ...THEME,
        description: "Chasing unpaid fees",
        acceptedBy: null,
        usedBy: ["Refund a deposit paid by cheque", "Chase an unpaid fee"],
      },
    ]);
  });
});

describe("decideTerm", () => {
  it("accept records who accepted and changes nothing else", () => {
    const next = decideTerm(intents, TAG, { decision: "accept", by: "human:bob" });
    expect(next[0]).toEqual({ ...intents[0], acceptedBy: "human:bob" });
    expect(next.slice(1)).toEqual(intents.slice(1));
    expect(proposedTerms(next)[0]!.acceptedBy).toBe("human:bob");
  });

  it("alias swaps the term in every note, without repeats, and adds the alias", () => {
    const next = decideTerm(intents, TAG, { decision: "alias", into: "refunds", by: "human:dana" });
    expect(next[0]).toEqual({
      type: "add_alias",
      kind: "tag",
      slug: "refunds",
      alias: TAG.slug,
      acceptedBy: "human:dana",
    });
    expect(next[2]).toMatchObject({ data: { tags: ["refunds"], themes: ["collections"] } });
    expect(next[4]).toMatchObject({ set: { tags: ["refunds"] } });
    expect(next[5]).toBe(intents[5]);
    expect(JSON.stringify(next)).not.toContain('"cheque-refunds"]');
  });

  it("reject removes the proposal and the term from the notes", () => {
    const next = decideTerm(intents, TAG, { decision: "reject" });
    expect(next.some((i) => i.type === "add_term" && i.slug === TAG.slug)).toBe(false);
    expect(next.some((i) => i.type === "add_alias")).toBe(false);
    expect(next[1]).toMatchObject({ data: { tags: ["refunds"] } });
    expect(next[3]).toMatchObject({ set: { tags: [] } });
  });

  it("does not change the intents it was given", () => {
    const before = structuredClone(intents);
    decideTerm(intents, TAG, { decision: "alias", into: "refunds", by: "human:dana" });
    decideTerm(intents, TAG, { decision: "reject" });
    expect(intents).toEqual(before);
  });

  it("refuses to reject a note's only theme", () => {
    expect(() => decideTerm(intents, THEME, { decision: "reject" })).toThrow(TermDecisionError);
    expect(() => decideTerm(intents, THEME, { decision: "reject" })).toThrow(
      /"Refund a deposit paid by cheque" would be left without a theme/,
    );
    const mapped = decideTerm(intents, THEME, {
      decision: "alias",
      into: "month-end-close",
      by: "human:dana",
    });
    expect(mapped[2]).toMatchObject({ data: { themes: ["month-end-close"] } });
    expect(mapped[3]).toMatchObject({ data: { themes: ["month-end-close"] } });
  });

  it("refuses a term the changeset does not propose, or one mapped to itself", () => {
    expect(() =>
      decideTerm(intents, { kind: "tag", slug: "refunds" }, { decision: "reject" }),
    ).toThrow(/does not propose/);
    expect(() =>
      decideTerm(intents, TAG, { decision: "alias", into: TAG.slug, by: "human:dana" }),
    ).toThrow(/different term/);
  });
});

describe("vocabularyDecided", () => {
  const accepted = decideTerm(
    decideTerm(intents, TAG, { decision: "accept", by: "human:dana" }),
    THEME,
    { decision: "alias", into: "month-end-close", by: "human:dana" },
  );

  it("is true once a maintainer has decided every proposed term", () => {
    expect(vocabularyDecided(intents, [], "kb")).toBe(false);
    expect(
      vocabularyDecided(
        decideTerm(intents, TAG, { decision: "accept", by: "human:dana" }),
        [],
        "kb",
      ),
    ).toBe(false);
    expect(vocabularyDecided(accepted, [], "kb")).toBe(true);
  });

  it("is false when the changeset changes the vocabulary in any other way", () => {
    expect(
      vocabularyDecided(
        [...accepted, { type: "rename_term", kind: "tag", from: "a", to: "b" }],
        [],
        "kb",
      ),
    ).toBe(false);
    expect(vocabularyDecided(accepted, [{ path: ".kb/tags.yaml" }], "kb")).toBe(false);
    expect(vocabularyDecided(accepted, [{ path: "kb/_themes/enrollment.md" }], "kb")).toBe(false);
    expect(
      vocabularyDecided(
        [...accepted, { type: "edit", path: "kb/_systems/sis.md", body: "" }],
        [],
        "kb",
      ),
    ).toBe(false);
    // Nothing was decided, so there is nothing to vouch for.
    expect(vocabularyDecided([intents[5]!], [], "kb")).toBe(false);
  });
});
