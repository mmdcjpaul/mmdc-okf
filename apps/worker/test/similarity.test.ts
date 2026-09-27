import { describe, expect, it } from "vitest";
import {
  clusters,
  contentWords,
  editDistance,
  jaccard,
  nearDuplicateSlugs,
} from "../src/gardener/similarity.ts";

describe("contentWords", () => {
  it("keeps the words that carry meaning, in the singular", () => {
    expect([...contentWords("Clean up duplicate contacts in the CRM")].sort()).toEqual([
      "clean",
      "contact",
      "crm",
      "duplicate",
      "up",
    ]);
    expect([...contentWords("Policies and classes")]).toEqual(["policy", "class"]);
  });
});

describe("jaccard", () => {
  it("is the share of words in common", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
    expect(jaccard(new Set(), new Set(["b"]))).toBe(0);
  });
});

describe("nearDuplicateSlugs", () => {
  it.each([
    ["refund", "refunds"],
    ["student-records", "records-student"],
    ["onboarding", "onbaording".replace("ao", "oa") + "s"],
    ["enrollment", "enrolment"],
  ])("%s and %s are probably the same term", (a, b) => {
    expect(nearDuplicateSlugs(a, b)).toBe(true);
  });

  it.each([
    ["refunds", "refunds"],
    ["leave", "laptops"],
    ["sis", "lms"],
    ["ap", "ar"],
    ["payroll", "payments"],
  ])("%s and %s are not", (a, b) => {
    expect(nearDuplicateSlugs(a, b)).toBe(false);
  });
});

describe("editDistance", () => {
  it("counts single-character edits", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
});

describe("clusters", () => {
  it("joins pairs that share a member", () => {
    const out = clusters([
      ["a", "b"],
      ["b", "c"],
      ["x", "y"],
    ]).map((c) => c.sort());
    expect(out.sort((p, q) => p[0]!.localeCompare(q[0]!))).toEqual([
      ["a", "b", "c"],
      ["x", "y"],
    ]);
  });
});
