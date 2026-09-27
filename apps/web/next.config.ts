import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@lore/ai", "@lore/auth", "@lore/db", "@lore/search"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
};

export default config;
