import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  initialVersion,
  isStale,
  isValidId,
  newId,
  parseActor,
  trustTier,
  verifications,
} from "./lifecycle.ts";

describe("bumpVersion", () => {
  it.each([
    ["1.2.0", "fix", "1.2.1"],
    ["1.2.1", "addition", "1.3.0"],
    ["1.3.0", "process", "2.0.0"],
    ["0.1.0", "fix", "0.1.1"],
    ["0.1.3", "addition", "0.2.0"],
    ["0.9.9", "process", "1.0.0"],
    ["9.9.9", "process", "10.0.0"],
  ] as const)("%s + %s = %s", (from, cls, to) => {
    expect(bumpVersion(from, cls)).toBe(to);
  });

  it("rejects versions that are not MAJOR.MINOR.PATCH", () => {
    expect(() => bumpVersion("1.0", "fix")).toThrow();
    expect(() => bumpVersion("v1.0.0", "fix")).toThrow();
  });

  it("starts drafts at 0.1.0 and everything else at 1.0.0", () => {
    expect(initialVersion("draft")).toBe("0.1.0");
    expect(initialVersion("stable")).toBe("1.0.0");
    expect(initialVersion(undefined)).toBe("1.0.0");
  });
});

describe("trustTier", () => {
  it.each([
    ["empty list", [], "unverified"],
    ["missing", undefined, "unverified"],
    ["machine only", [{ by: "process:link-check", at: "2026-01-01T00:00:00Z" }], "machine"],
    ["agent only", [{ by: "lore-ingest/claude-sonnet-5", at: "2026-01-01T00:00:00Z" }], "machine"],
    ["human", [{ by: "human:mreyes", at: "2026-01-01T00:00:00Z" }], "human"],
    [
      "human and machine",
      [
        { by: "process:x", at: "2026-01-01T00:00:00Z" },
        { by: "human:a", at: "2026-01-02T00:00:00Z" },
      ],
      "human",
    ],
    ["single map form", { by: "human:jlim", at: "2026-09-10T03:00:00Z" }, "human"],
  ])("%s", (_name, verified, tier) => {
    expect(trustTier(verified)).toBe(tier);
  });

  it("normalizes a single verification map to a list", () => {
    expect(verifications({ by: "human:a", at: "x" })).toEqual([{ by: "human:a", at: "x" }]);
    expect(verifications("nonsense")).toEqual([]);
  });
});

describe("isStale", () => {
  const note = (stale_after?: string) => ({ data: stale_after ? { stale_after } : {} });
  const boundary = "2027-03-02T00:00:00Z";
  it.each([
    ["one millisecond before", "2027-03-01T23:59:59.999Z", false],
    ["exactly at stale_after", "2027-03-02T00:00:00.000Z", true],
    ["after", "2027-03-02T00:00:00.001Z", true],
  ])("%s", (_name, now, stale) => {
    expect(isStale(note(boundary), new Date(now))).toBe(stale);
  });

  it("never marks notes without stale_after as stale", () => {
    expect(isStale(note(), new Date("2100-01-01T00:00:00Z"))).toBe(false);
  });

  it("respects time zone offsets", () => {
    expect(isStale(note("2027-03-02T08:00:00+08:00"), new Date(boundary))).toBe(true);
  });
});

describe("ids and actors", () => {
  it("creates prefixed ULIDs", () => {
    const id = newId("kb_", new Date("2026-09-24T00:00:00Z"));
    expect(isValidId(id)).toBe(true);
    expect(id.startsWith("kb_01")).toBe(true);
    expect(newId()).not.toBe(newId());
  });

  it("rejects malformed ids", () => {
    expect(isValidId("kb_123")).toBe(false);
    expect(isValidId("xx_01J9Z6Q4X8M2T7C3VQ5R1N0B8D")).toBe(false);
    expect(isValidId("kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8I")).toBe(false);
  });

  it.each([
    ["human:mreyes", { kind: "human", id: "mreyes" }],
    ["process:gardener", { kind: "process", id: "gardener" }],
    ["claude-code/claude-sonnet-5", { kind: "agent", id: "claude-code", model: "claude-sonnet-5" }],
    ["mreyes", null],
    ["human:", null],
  ])("parses %s", (actor, parsed) => {
    expect(parseActor(actor)).toEqual(parsed);
  });
});
