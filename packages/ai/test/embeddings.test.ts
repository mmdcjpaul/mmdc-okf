import { describe, expect, it } from "vitest";
import {
  embedderFor,
  EmbeddingUnavailableError,
  HashEmbedder,
  LocalEmbedder,
} from "../src/index.ts";

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

// Downloads a few hundred megabytes on first run, so it is opt-in: LORE_TEST_LOCAL_EMBEDDINGS=1.
describe.skipIf(!process.env.LORE_TEST_LOCAL_EMBEDDINGS)("LocalEmbedder", () => {
  const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

  it("returns 1,024-dimensional unit vectors that capture meaning, not shared words", async () => {
    const e = new LocalEmbedder();
    expect(e.model).toBe("local:mixedbread-ai/mxbai-embed-large-v1@1024");
    const [reenroll, payroll] = await e.embed([
      "Enroll a returning student: reactivate their record in Salesforce and confirm the term.",
      "The payroll calendar lists cut-off dates and pay days for each month.",
    ]);
    expect(reenroll).toHaveLength(1024);
    expect(cosine(reenroll!, reenroll!)).toBeCloseTo(1, 3);
    // No word in common with the first passage, yet it is the closer one.
    const q = await e.embedQuery("someone who left last year wants to come back to school");
    expect(cosine(q, reenroll!)).toBeGreaterThan(cosine(q, payroll!) + 0.1);
  }, 600_000);

  it("reports a model with the wrong size as unavailable", async () => {
    const e = new LocalEmbedder({ model: "Xenova/all-MiniLM-L6-v2" });
    await expect(e.embed(["hello"])).rejects.toThrow(/384 dimensions; the index needs 1024/);
  }, 600_000);
});
