import { defineConfig } from "vitest/config";

/** Integration tests: Postgres, Meilisearch, and a bare repository. Needs `pnpm services:up`. */
export default defineConfig({
  test: {
    name: "worker-int",
    include: ["test/**/*.int.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Each file creates its own database, but they share one Meilisearch task queue.
    fileParallelism: false,
  },
});
