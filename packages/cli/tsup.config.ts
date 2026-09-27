import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: { kb: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  clean: true,
  define: { __KB_VERSION__: JSON.stringify(version) },
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __kbCreateRequire } from 'node:module';\nconst require = __kbCreateRequire(import.meta.url);",
  },
});
