import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/okf",
      "packages/cli",
      "packages/git",
      "packages/ai",
      "packages/auth",
      "packages/search",
      "apps/worker",
      "apps/web",
    ],
  },
});
