import { describe, expect, it } from "vitest";
import {
  changedFields,
  conflictMarkers,
  linkHref,
  markdownLink,
  openWikilink,
  pastedImageName,
  suggestChangeClass,
} from "../src/components/editor/links";

describe("linkHref", () => {
  const from = "kb/admissions/actions/resend.md";
  it("writes bundle-absolute links", () => {
    expect(linkHref("kb", from, "kb/finance/refund-policy.md", "absolute")).toBe(
      "/finance/refund-policy.md",
    );
  });
  it("writes relative links from the note's folder", () => {
    expect(linkHref("kb", from, "kb/finance/refund-policy.md", "relative")).toBe(
      "../../finance/refund-policy.md",
    );
    expect(linkHref("kb", from, "kb/admissions/actions/other.md", "relative")).toBe("./other.md");
    expect(linkHref("kb", from, "kb/admissions/enroll.md", "relative")).toBe("../enroll.md");
  });
  it("encodes spaces", () => {
    expect(linkHref("kb", from, "kb/finance/a b.md", "absolute")).toBe("/finance/a%20b.md");
  });
});

describe("markdownLink", () => {
  it("escapes brackets in the title", () => {
    expect(markdownLink("Refunds [EU]", "/finance/refunds.md")).toBe(
      "[Refunds \\[EU\\]](/finance/refunds.md)",
    );
  });
});

describe("openWikilink", () => {
  it("finds the link being typed", () => {
    expect(openWikilink("See [[refund pol")).toEqual({ from: 4, query: "refund pol" });
    expect(openWikilink("[[")).toEqual({ from: 0, query: "" });
  });
  it("ignores closed links, other lines, and plain brackets", () => {
    expect(openWikilink("See [[refund]] and")).toBeNull();
    expect(openWikilink("See [[refund\nnext")).toBeNull();
    expect(openWikilink("See [refund")).toBeNull();
  });
  it("uses the last one", () => {
    expect(openWikilink("[[a]] then [[b")).toEqual({ from: 11, query: "b" });
  });
});

describe("suggestChangeClass", () => {
  const note = "# Steps\n\n1. Open the record.\n2. Set the status.\n\nAsk IT if it fails.\n";
  it("preselects Fix for a typo", () => {
    expect(suggestChangeClass(note, note.replace("it fails", "this fails"))).toBe("fix");
    expect(suggestChangeClass(note, note)).toBe("fix");
  });
  it("preselects Addition for a new paragraph, step, or heading", () => {
    const para = Array(40).fill("word").join(" ");
    expect(suggestChangeClass(note, note + `\n${para}\n`)).toBe("addition");
    expect(suggestChangeClass(note, note.replace("2. Set", "2. Check the ID.\n3. Set"))).toBe(
      "addition",
    );
    expect(suggestChangeClass(note, note + "\n# Exceptions\n\nNone.\n")).toBe("addition");
  });
  it("never preselects a Process change", () => {
    expect(suggestChangeClass(note, "# Steps\n\n1. Do it all differently.\n")).not.toBe("process");
  });
});

describe("conflictMarkers", () => {
  it("finds unresolved merge markers by line", () => {
    expect(conflictMarkers("a\n<<<<<<< yours\nb\n=======\nc\n>>>>>>> theirs\nd")).toEqual([
      2, 4, 6,
    ]);
  });
  it("ignores lookalikes inside text", () => {
    expect(conflictMarkers("a ======= b\n> quote\n====\n`<<<<<<<`")).toEqual([]);
  });
});

describe("pastedImageName", () => {
  const at = new Date("2026-09-27T08:05:09Z");
  it("names an image after the note", () => {
    expect(pastedImageName("refund-policy", "image/png", at, 0)).toBe(
      "refund-policy-20260927080509.png",
    );
    expect(pastedImageName("refund-policy", "image/jpeg", at, 2)).toBe(
      "refund-policy-20260927080509-2.jpg",
    );
  });
  it("refuses what is not an image the vault accepts", () => {
    expect(pastedImageName("x", "image/svg+xml", at, 0)).toBeNull();
    expect(pastedImageName("x", "application/pdf", at, 0)).toBeNull();
  });
  it("cannot be steered into another folder", () => {
    expect(pastedImageName("../../etc", "image/png", at, 0)).toBe("etc-20260927080509.png");
  });
});

describe("changedFields", () => {
  it("sends only what changed", () => {
    expect(
      changedFields(
        { title: "A", tags: ["x"], owner: "team", aliases: ["a"], audience: "all" },
        { title: "B", tags: ["x"], owner: "", aliases: [], audience: "all", systems: ["sis"] },
      ),
    ).toEqual({ set: { title: "B", systems: ["sis"] }, unset: ["aliases", "owner"] });
  });
  it("sends nothing when nothing changed", () => {
    expect(changedFields({ a: [1, 2], b: undefined }, { a: [1, 2], b: "" })).toEqual({
      set: {},
      unset: [],
    });
  });
});
