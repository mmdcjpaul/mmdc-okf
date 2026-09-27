/** Starts the web app with the environment `prepare.ts` wrote, once it exists. */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { VAULT, WEB_ENV_FILE, WEB_PORT, WORKER_ENV, WORKER_PORT } from "./env.ts";

const deadline = Date.now() + 120_000;
while (!existsSync(WEB_ENV_FILE)) {
  if (Date.now() > deadline) throw new Error(`${WEB_ENV_FILE} was not written`);
  await sleep(250);
}
const fileEnv = Object.fromEntries(
  readFileSync(WEB_ENV_FILE, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

// A production build when asked (CI), the dev server otherwise. Dev login needs a
// non-production NODE_ENV either way, which is the guard working as intended.
const production = process.env.E2E_BUILD === "1";
const child = spawn(
  "pnpm",
  production
    ? ["exec", "next", "start", "--port", String(WEB_PORT)]
    : ["exec", "next", "dev", "--port", String(WEB_PORT)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...fileEnv,
      LORE_VAULT: VAULT,
      WORKER_URL: `http://127.0.0.1:${WORKER_PORT}`,
      INTERNAL_API_TOKEN: WORKER_ENV.INTERNAL_API_TOKEN!,
      AUTH_DEV_LOGIN: "true",
      // The fixture's people are all at acme.test, so the allow-list can be on.
      AUTH_ALLOWED_DOMAINS: "acme.test",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
