import { defineConfig } from "vitest/config";

/** Tests that write to a real GitHub repository. Run by the nightly `live` job only. */
export default defineConfig({
  test: { name: "git-live", include: ["test/live/**/*.live.ts"], testTimeout: 120_000 },
});
