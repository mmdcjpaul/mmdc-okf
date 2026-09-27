/**
 * The `@live` check (plans/02-library.md, L10): one tiny batch per provider that has a key,
 * against the real service. It costs a fraction of a cent. It is not part of `pnpm test`:
 *
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... pnpm --filter @lore/ai test:live
 *
 * A batch can take longer than the check waits. The check then passes on what it could
 * see, that the provider accepted the batch and reports it as running, and says so.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AnthropicBatchClient,
  GoogleBatchClient,
  OpenAiBatchClient,
} from "../../src/batch/index.ts";
import { customIdOf, type BatchClient } from "../../src/index.ts";

const Answer = z.object({ capital: z.string() });
const WAIT_MS = Number(process.env.LIVE_BATCH_WAIT_MINUTES ?? 20) * 60_000;

const providers: {
  name: string;
  key: string | undefined;
  model: string;
  make: (key: string) => BatchClient;
}[] = [
  {
    name: "anthropic",
    key: process.env.ANTHROPIC_API_KEY,
    model: process.env.LIVE_ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    make: (apiKey) => new AnthropicBatchClient({ apiKey }),
  },
  {
    name: "openai",
    key: process.env.OPENAI_API_KEY,
    model: process.env.LIVE_OPENAI_MODEL ?? "",
    make: (apiKey) => new OpenAiBatchClient({ apiKey }),
  },
  {
    name: "google",
    key: process.env.GEMINI_API_KEY,
    model: process.env.LIVE_GOOGLE_MODEL ?? "",
    make: (apiKey) => new GoogleBatchClient({ apiKey }),
  },
];

describe("batch APIs, live", () => {
  for (const p of providers) {
    // A provider with no key, or no model named for it, is skipped and shown as skipped.
    it.skipIf(!p.key || !p.model)(
      `${p.name} accepts a batch and answers it`,
      async () => {
        const client = p.make(p.key!);
        const customId = await customIdOf(`live:${p.name}:${Date.now()}`);
        const id = await client.submit([
          {
            customId,
            model: p.model,
            request: {
              instructions: "Answer with the capital city of the country you are given.",
              context: [],
              input: "France",
              images: [],
              schema: z.toJSONSchema(Answer) as Record<string, unknown>,
              maxOutputTokens: 200,
            },
          },
        ]);
        expect(id).toBeTruthy();
        const started = Date.now();
        let status = await client.status(id);
        while (status.state === "running" && Date.now() - started < WAIT_MS) {
          await new Promise((r) => setTimeout(r, 30_000));
          status = await client.status(id);
        }
        expect(status.state).not.toBe("failed");
        if (status.state === "running") {
          console.warn(`${p.name}: batch ${id} was accepted and is still running; not waited for`);
          return;
        }
        const results = await client.results(id);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ customId, ok: true });
        expect(Answer.parse(JSON.parse(results[0]!.text!)).capital).toMatch(/paris/i);
        expect(results[0]!.usage!.output).toBeGreaterThan(0);
      },
      WAIT_MS + 120_000,
    );
  }
});
