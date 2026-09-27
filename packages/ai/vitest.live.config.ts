import { defineConfig } from "vitest/config";

/** Tests that call the real providers. Run by the nightly `live` job, never by `pnpm test`. */
export default defineConfig({
  test: { name: "ai-live", include: ["test/live/**/*.live.ts"], testTimeout: 30 * 60_000 },
});
