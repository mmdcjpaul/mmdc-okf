import { resolve } from "node:path";
import { z } from "zod";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().url().default("postgres://lore:lore@127.0.0.1:5433/lore"),
  MEILI_URL: z.string().url().default("http://127.0.0.1:7701"),
  MEILI_MASTER_KEY: z.string().min(1).default("lore-dev-master-key"),
  GIT_PROVIDER: z.enum(["local"]).default("local"),
  EMBEDDINGS: z.enum(["hash", "off", "fail"]).default("hash"),
  AI_MODE: z.enum(["fake", "off", "live"]).default("off"),
  /** Bare repositories, mirrors, and the local object store. */
  DATA_DIR: z.string().default(resolve(REPO_ROOT, ".data")),
  WORKER_PORT: z.coerce.number().int().default(8081),
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
  return { ...parsed.data, repoRoot: REPO_ROOT };
}
