import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@lore/ai", "@lore/auth", "@lore/db", "@lore/ingest", "@lore/search"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  // The repository has its own agent instructions; Next should not write more into apps/web.
  agentRules: false,
};

export default config;
