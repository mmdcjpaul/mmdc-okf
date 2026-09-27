import "server-only";
import { assertDevLoginAllowed } from "@lore/auth";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().url(),
  MEILI_URL: z.string().url(),
  /** Search-only key. The web app never holds the admin key. */
  MEILI_SEARCH_KEY: z.string().min(1),
  /** Local object store for assets (the Lightsail bucket in production). */
  DATA_DIR: z.string().min(1),
  /** Slug of the vault to show. The data model supports several; the picker is phase 3. */
  LORE_VAULT: z.string().optional(),
  APP_SECRET: z.string().min(16),
  AUTH_DEV_LOGIN: z.enum(["true", "false"]).default("false"),
  EMBEDDINGS: z.enum(["hash", "off", "fail"]).default("hash"),
  FEATURE_DESK: z.enum(["true", "false"]).default("false"),
});

export type WebEnv = z.infer<typeof Env>;

let cached: WebEnv | null = null;

/** Validated environment. Throws with every problem listed, so a bad deploy fails fast. */
export function env(): WebEnv {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Invalid web configuration (run \`pnpm lore seed\` to write apps/web/.env.local):\n${lines.join("\n")}`,
    );
  }
  assertDevLoginAllowed(parsed.data);
  cached = parsed.data;
  return cached;
}
