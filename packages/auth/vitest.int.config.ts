import { defineConfig } from "vitest/config";

/** Sign-in against a real Postgres. Needs `pnpm services:up`. */
export default defineConfig({
  test: { name: "auth-int", include: ["test/**/*.int.test.ts"], testTimeout: 60_000 },
});
