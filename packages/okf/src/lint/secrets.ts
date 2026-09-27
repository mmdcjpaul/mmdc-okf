import { lintSource } from "@secretlint/core";
import { creator as presetRecommend } from "@secretlint/secretlint-rule-preset-recommend";
import type { Issue } from "../types.ts";

const config = {
  rules: [{ id: "@secretlint/secretlint-rule-preset-recommend", rule: presetRecommend }],
} as const;

/**
 * Cheap prefilter: text without any of these hints cannot match the recommended rules,
 * so most notes skip the full secretlint pass.
 */
const HINT_RE =
  /(AKIA|ASIA|aws|secret|token|key|passw|pwd|BEGIN [A-Z ]*PRIVATE|xox[abposr]-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|sk-|sk_live|rk_live|SG\.|npm_|AIza|hooks\.slack|:\/\/[^\s/:]+:[^\s/@]+@|shpat_|shpss_|dop_v1_|lin_api_|pypi-|eyJ)/i;

/** Runs secretlint's recommended rules over a file. */
export async function scanSecrets(path: string, content: string): Promise<Issue[]> {
  if (!HINT_RE.test(content)) return [];
  const result = await lintSource({
    source: { content, filePath: path, ext: ".md", contentType: "text" },
    options: { config: config as never, maskSecrets: true, noPhysicFilePath: true },
  });
  return result.messages.map((m) => ({
    rule: "lore/secrets",
    severity: "error" as const,
    path,
    line: m.loc.start.line,
    column: m.loc.start.column + 1,
    message: `Possible secret (${m.ruleId.replace(/^@secretlint\/secretlint-rule-/, "")}): ${m.message}`,
  }));
}
