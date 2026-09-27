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
  /** Encrypts provider keys saved in Admin. 32 bytes, as 64 hex characters or base64. */
  APP_ENCRYPTION_KEY: z.string().optional(),
  AUTH_DEV_LOGIN: z.enum(["true", "false"]).default("false"),
  /** Where people open the Library. Sign-in links and provider callbacks are built from it. */
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  /** Email domains that may sign in, separated by commas. Required in production. */
  AUTH_ALLOWED_DOMAINS: z.string().default(""),
  AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  AUTH_MICROSOFT_CLIENT_ID: z.string().optional(),
  AUTH_MICROSOFT_CLIENT_SECRET: z.string().optional(),
  /** The Entra tenant whose people may sign in. */
  AUTH_MICROSOFT_TENANT_ID: z.string().optional(),
  /** Sign in with a link sent by email. Needs the worker to have SMTP_URL. */
  AUTH_EMAIL_LINK: z.enum(["true", "false"]).default("false"),
  /** `local` runs a model on this machine with transformers.js. */
  EMBEDDINGS: z.enum(["hash", "local", "off", "fail"]).default("hash"),
  EMBEDDINGS_LOCAL_MODEL: z.string().optional(),
  EMBEDDINGS_CACHE_DIR: z.string().optional(),
  /** Whether models are called at all. The worker makes the calls; this is for what forms say. */
  AI_MODE: z.enum(["fake", "off", "live"]).default("off"),
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
  if (parsed.data.NODE_ENV === "production" && parsed.data.AUTH_DEV_LOGIN !== "true") {
    const problems = [
      ...(parsed.data.AUTH_ALLOWED_DOMAINS.trim()
        ? []
        : ["AUTH_ALLOWED_DOMAINS: name the email domains that may sign in"]),
      ...(parsed.data.APP_SECRET.length < 32 ? ["APP_SECRET: use at least 32 characters"] : []),
    ];
    // A build has no people signing in, so it is not held to this.
    if (problems.length && process.env.NEXT_PHASE !== "phase-production-build")
      throw new Error(`Invalid web configuration:\n  ${problems.join("\n  ")}`);
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.INTERNAL_API_TOKEN === "lore-dev-internal-token"
  ) {
    throw new Error("Invalid web configuration:\n  INTERNAL_API_TOKEN: set a secret value");
  }
  cached = parsed.data;
  return cached;
}
