import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiSdkModelProvider, InvalidOutputError } from "../src/index.ts";

const Plan = z.object({ title: z.string(), tags: z.array(z.string()) });

function mock(text: string, usage: Record<string, unknown> = {}) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "end_turn" },
      usage: {
        inputTokens: { total: 5000, noCache: 300, cacheRead: 4500, cacheWrite: 200 },
        outputTokens: { total: 120, text: 120, reasoning: 0 },
        ...usage,
      },
      warnings: [],
    }),
  });
}

describe("AiSdkModelProvider", () => {
  it("is available only for providers with a key", () => {
    const p = new AiSdkModelProvider({ anthropic: "sk-test" });
    expect(p.available("anthropic")).toBe(true);
    expect(p.available("openai")).toBe(false);
  });

  it("sends stable content first, with the cache breakpoint after the last stable block", async () => {
    const model = mock('{"title":"Refunds","tags":["refunds"]}');
    const p = new AiSdkModelProvider({}, { anthropic: () => model });
    const res = await p.generate("anthropic", "claude-sonnet-5", {
      instructions: "Plan notes from the document.",
      context: ["Vocabulary: refunds, deposits.", "Profile: one idea per note."],
      input: "<document>Refund within 30 days.</document>",
      schema: Plan,
      maxOutputTokens: 4000,
    });
    expect(res.output).toEqual({ title: "Refunds", tags: ["refunds"] });
    expect(res.usage).toEqual({ input: 300, output: 120, cacheRead: 4500, cacheWrite: 200 });

    const [call] = model.doGenerateCalls;
    const prompt = call!.prompt;
    expect(prompt.map((m) => m.role)).toEqual(["system", "system", "system", "user"]);
    expect(prompt.slice(0, 3).map((m) => m.content)).toEqual([
      "Plan notes from the document.",
      "Vocabulary: refunds, deposits.",
      "Profile: one idea per note.",
    ]);
    // Only the last stable block carries the breakpoint: everything up to it is cached,
    // and the input after it is not.
    expect(prompt.slice(0, 3).map((m) => m.providerOptions?.anthropic?.cacheControl)).toEqual([
      undefined,
      undefined,
      { type: "ephemeral" },
    ]);
    expect(JSON.stringify(prompt[3])).not.toContain("cacheControl");
    expect(JSON.stringify(prompt[3])).toContain("Refund within 30 days.");
    expect(call!.maxOutputTokens).toBe(4000);
    expect(call!.responseFormat).toMatchObject({ type: "json" });
  });

  it("sends images before the text", async () => {
    const model = mock('{"title":"x","tags":[]}');
    const p = new AiSdkModelProvider({}, { anthropic: () => model });
    await p.generate("anthropic", "claude-sonnet-5", {
      instructions: "Read the image.",
      input: "What does it say?",
      images: [{ bytes: new Uint8Array([137, 80, 78, 71]), mediaType: "image/png" }],
      schema: Plan,
      maxOutputTokens: 1000,
    });
    const user = model.doGenerateCalls[0]!.prompt.at(-1)!;
    expect((user.content as { type: string }[]).map((c) => c.type)).toEqual(["file", "text"]);
  });

  it("reports an answer that does not fit the schema", async () => {
    const p = new AiSdkModelProvider({}, { anthropic: () => mock('{"title": 5}') });
    await expect(
      p.generate("anthropic", "claude-sonnet-5", {
        instructions: "x",
        input: "y",
        schema: Plan,
        maxOutputTokens: 100,
      }),
    ).rejects.toBeInstanceOf(InvalidOutputError);
  });
});
