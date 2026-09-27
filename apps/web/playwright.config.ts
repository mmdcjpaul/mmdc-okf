import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, WORKER_ENV, WORKER_PORT } from "./e2e/env.ts";

const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // The specs share one vault, and some of them push to it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  // Saving a note commits, indexes, and then navigates; allow for a busy machine. CI's
  // runners take about two and a half times as long as a laptop, so they get longer.
  timeout: process.env.CI ? 180_000 : 60_000,
  expect: { timeout: process.env.CI ? 45_000 : 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/prepare.ts && node ../worker/src/main.ts",
      url: `http://127.0.0.1:${WORKER_PORT}/health`,
      env: { ...env, ...WORKER_ENV },
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: "node e2e/start-web.ts",
      url: `${BASE_URL}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
