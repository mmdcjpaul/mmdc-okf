import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "changesets", include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
