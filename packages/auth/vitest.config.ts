import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "auth",
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.int.test.ts"],
    testTimeout: 60_000,
  },
});
