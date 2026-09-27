import { describe, expect, it } from "vitest";
import { embedderFor, EmbeddingUnavailableError, HashEmbedder } from "../src/index.ts";

describe("HashEmbedder", () => {
  const e = new HashEmbedder();

  it("is deterministic, 1,024-dimensional, and unit length", async () => {
    const [a, b] = await e.embed(["Reset a learner password", "Reset a learner password"]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1024);
    const norm = Math.sqrt(a!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it("scores overlapping text above unrelated text", () => {
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    const q = e.embedOne("password reset for learners");
    expect(dot(q, e.embedOne("How to reset a learner password"))).toBeGreaterThan(
      dot(q, e.embedOne("Monthly general ledger close")),
    );
  });

  it("returns a zero-safe vector for empty text", () => {
    expect(e.embedOne("").every((x) => x === 0)).toBe(true);
  });
});

describe("embedderFor", () => {
  it("maps modes", async () => {
    expect(embedderFor("hash")?.model).toBe("hash-1024");
    expect(embedderFor("off")).toBeNull();
    await expect(embedderFor("fail")!.embed(["x"])).rejects.toBeInstanceOf(
      EmbeddingUnavailableError,
    );
    expect(() => embedderFor("provider")).toThrow(/not supported yet/);
  });
});
