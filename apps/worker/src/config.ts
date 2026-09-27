import { resolve } from "node:path";
import { z } from "zod";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().url().default("postgres://lore:lore@127.0.0.1:5433/lore"),
  MEILI_URL: z.string().url().default("http://127.0.0.1:7701"),
  MEILI_MASTER_KEY: z.string().min(1).default("lore-dev-master-key"),
  GIT_PROVIDER: z.enum(["local"]).default("local"),
  /** `local` runs a model on this machine with transformers.js. */
  EMBEDDINGS: z.enum(["hash", "local", "off", "fail"]).default("hash"),
  EMBEDDINGS_LOCAL_MODEL: z.string().optional(),
  EMBEDDINGS_CACHE_DIR: z.string().optional(),
  AI_MODE: z.enum(["fake", "off", "live"]).default("off"),
  /** Scripted answers for AI_MODE=fake. */
  AI_FAKE_SCRIPTS: z.string().default(resolve(REPO_ROOT, "packages/ai/test/scripts")),
  /** Encrypts provider keys in settings. 32 bytes, as 64 hex characters or base64. */
  APP_ENCRYPTION_KEY: z.string().optional(),
  /** Bare repositories and mirrors (and the object store when OBJECT_STORE=fs). */
  DATA_DIR: z.string().default(resolve(REPO_ROOT, ".data")),
  /** `s3` is any S3-compatible store. `fs` keeps objects under DATA_DIR and cannot serve browsers. */
  OBJECT_STORE: z.enum(["s3", "fs"]).default("s3"),
  S3_ENDPOINT: z.string().url().default("http://127.0.0.1:9002"),
  /** Endpoint browsers use for signed URLs, when it differs from S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("lore"),
  S3_ACCESS_KEY_ID: z.string().default("lore"),
  S3_SECRET_ACCESS_KEY: z.string().default("lore-dev-secret"),
  WORKER_PORT: z.coerce.number().int().default(8081),
  /** Interface for /health and the mirror API. Containers set 0.0.0.0. */
  WORKER_HOST: z.string().default("127.0.0.1"),
  /** Shared with the web app; guards the worker's internal API. */
  INTERNAL_API_TOKEN: z.string().min(16).default("lore-dev-internal-token"),
  /** How often the worker checks every vault for new commits, in seconds. */
  POLL_SECONDS: z.coerce.number().int().positive().default(300),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof Env> & { repoRoot: string };

/** Reads and validates the environment. Fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid worker configuration:\n${lines.join("\n")}`);
  }
  if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.INTERNAL_API_TOKEN === "lore-dev-internal-token"
  ) {
    throw new Error("Invalid worker configuration:\n  INTERNAL_API_TOKEN: set a secret value");
  }
  if (parsed.data.AI_MODE === "live" && !parsed.data.APP_ENCRYPTION_KEY)
    throw new Error(
      "Invalid worker configuration:\n  APP_ENCRYPTION_KEY: needed to read provider keys when AI_MODE=live",
    );
  return { ...parsed.data, repoRoot: REPO_ROOT };
}
