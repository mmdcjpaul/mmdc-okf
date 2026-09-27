import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  // The end-to-end suite builds into its own folder so it can run beside a dev server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Container images run the standalone server, traced from the workspace root.
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
      }
    : {}),
  // Workspace packages ship TypeScript source.
  transpilePackages: [
    "@lore/ai",
    "@lore/auth",
    "@lore/db",
    "@lore/ingest",
    "@lore/search",
    "@lore/ui",
  ],
  serverExternalPackages: ["postgres", "@huggingface/transformers", "onnxruntime-node"],
  poweredByHeader: false,
  // The repository has its own agent instructions; Next should not write more into apps/web.
  agentRules: false,
};

export default config;
