import { describe, expect, it } from "vitest";
import { DEFAULT_HEALTH_WEIGHTS, healthScore, type HealthInput } from "../src/repos/feedback.ts";

const good: HealthInput = { stale: false, trust: "human", brokenLinks: 0 };

describe("healthScore", () => {
  it("is 100 for a verified, current note with no reports and no broken links", () => {
    expect(healthScore(good)).toBe(100);
  });

  it.each([
    ["an open incorrect or outdated report", { seriousReports: 1, reports: 1 }, 75],
    ["two of them", { seriousReports: 2, reports: 2 }, 50],
    ["another kind of open report", { otherReports: 1, reports: 1 }, 90],
    ["being stale", { stale: true }, 80],
    ["being unverified", { trust: "unverified" }, 90],
    ["machine verification only", { trust: "machine" }, 100],
    ["a broken link", { brokenLinks: 1 }, 95],
    ["three broken links", { brokenLinks: 3 }, 85],
  ])("loses points for %s", (_name, change, expected) => {
    expect(healthScore({ ...good, ...change })).toBe(expected);
  });

  it("adds up", () => {
    expect(
      healthScore({
        stale: true,
        trust: "unverified",
        brokenLinks: 2,
        seriousReports: 1,
        otherReports: 1,
        reports: 2,
      }),
    ).toBe(100 - 20 - 10 - 10 - 25 - 10);
  });

  it("gains up to 10 from the helpful rate, once there are enough ratings", () => {
    const stale = { ...good, stale: true };
    expect(healthScore({ ...stale, helpful: 2 })).toBe(80); // too few to count
    expect(healthScore({ ...stale, helpful: 3 })).toBe(90);
    expect(healthScore({ ...stale, helpful: 3, reports: 3 })).toBe(85);
    expect(healthScore({ ...stale, helpful: 0, reports: 4 })).toBe(80);
  });

  it("closed reports still count against the helpful rate, but carry no penalty", () => {
    expect(healthScore({ ...good, stale: true, helpful: 1, reports: 3 })).toBe(83);
  });

  it("stays between 0 and 100", () => {
    expect(healthScore({ ...good, helpful: 50 })).toBe(100);
    expect(healthScore({ ...good, seriousReports: 9, reports: 9 })).toBe(0);
  });

  it("uses the weights from settings", () => {
    const w = { ...DEFAULT_HEALTH_WEIGHTS, stale: 40, unverified: 0 };
    expect(healthScore({ stale: true, trust: "unverified", brokenLinks: 0 }, w)).toBe(60);
  });
});
