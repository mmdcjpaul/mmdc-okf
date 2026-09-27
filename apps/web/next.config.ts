import type { NextConfig } from "next";

const config: NextConfig = {
  // The end-to-end suite builds into its own folder so it can run beside a dev server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@lore/ai", "@lore/auth", "@lore/db", "@lore/ingest", "@lore/search"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  // The repository has its own agent instructions; Next should not write more into apps/web.
  agentRules: false,
};

export default config;
