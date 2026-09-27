import "server-only";
import { assertDevLoginAllowed } from "@lore/auth";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().url(),
  MEILI_URL: z.string().url(),
  /** Search-only key. The web app never holds the admin key. */
  MEILI_SEARCH_KEY: z.string().min(1),
  /** Object store for assets. The endpoint must be reachable by browsers: signed URLs point at it. */
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  /** The worker's internal API, for anything that needs Git (history diffs). */
  WORKER_URL: z.string().url().default("http://127.0.0.1:8081"),
  INTERNAL_API_TOKEN: z.string().min(16).default("lore-dev-internal-token"),
  /** Slug of the vault to show. The data model supports several; the picker is phase 3. */
  LORE_VAULT: z.string().optional(),
  APP_SECRET: z.string().min(16),
  AUTH_DEV_LOGIN: z.enum(["true", "false"]).default("false"),
  /** `local` runs a model on this machine with transformers.js. */
  EMBEDDINGS: z.enum(["hash", "local", "off", "fail"]).default("hash"),
  EMBEDDINGS_LOCAL_MODEL: z.string().optional(),
  EMBEDDINGS_CACHE_DIR: z.string().optional(),
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
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.INTERNAL_API_TOKEN === "lore-dev-internal-token"
  ) {
    throw new Error("Invalid web configuration:\n  INTERNAL_API_TOKEN: set a secret value");
  }
  cached = parsed.data;
  return cached;
}
