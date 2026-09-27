import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "okf", include: ["src/**/*.test.ts", "test/**/*.test.ts"], testTimeout: 30_000 },
});
