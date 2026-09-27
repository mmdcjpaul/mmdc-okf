import { defineConfig } from "vitest/config";

/** Integration tests against the S3-compatible store. Needs `pnpm services:up`. */
export default defineConfig({
  test: { name: "ingest-int", include: ["test/**/*.int.test.ts"], testTimeout: 60_000 },
});
