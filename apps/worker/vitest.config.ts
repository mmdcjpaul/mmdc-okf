import { defineConfig } from "vitest/config";

/** Unit tests: no services. Integration tests are `*.int.test.ts` (see vitest.int.config.ts). */
export default defineConfig({
  test: {
    name: "worker",
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.int.test.ts"],
    testTimeout: 60_000,
  },
});
