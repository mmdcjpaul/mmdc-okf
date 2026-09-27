import { generateIndexes } from "../indexes.ts";
import { newId } from "../lifecycle.ts";
import { basename, hubKindOf } from "../paths.ts";
import { compactOps, OverlaySource } from "../source.ts";
import type { FileOp, Issue } from "../types.ts";
import { loadVault, type Vault } from "../vault.ts";
import {
  effectiveSeverity,
  FixContext,
  type FixOptions,
  type LintReport,
  type RuleConfig,
} from "./engine.ts";
import { RULES } from "./rules.ts";

/** Options for {@link lint}. */
export interface LintOptions {
  /** Report only issues in these repository paths (files or folders). */
  paths?: string[];
  /** Per-rule overrides on top of the profile's `rules`. */
  rules?: RuleConfig;
  now?: Date;
}

function inPaths(path: string, paths: string[] | undefined): boolean {
  if (!paths || paths.length === 0) return true;
  return paths.some((p) => {
    const clean = p.replace(/\/+$/, "");
    return path === clean || path.startsWith(clean + "/");
  });
}

function sortIssues(issues: Issue[]): Issue[] {
  return issues.sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0) ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
      (a.message < b.message ? -1 : 1),
  );
}

/**
 * Runs every lint rule. The same function backs `kb lint`, vault CI, and the Library's
 * ingestion pipeline, so all writers pass one set of rules.
 */
export async function lint(vault: Vault, opts: LintOptions = {}): Promise<LintReport> {
  const config: RuleConfig = { ...vault.profile.rules, ...opts.rules };
  const targets = [...vault.notes.values()].filter((n) => inPaths(n.path, opts.paths));
  const ctx = { vault, targets, now: opts.now ?? new Date() };
  const issues: Issue[] = [];
  for (const rule of RULES) {
    const severity = effectiveSeverity(rule, config);
    if (severity === null) continue;
    const found = await rule.check(ctx);
    const overridden = config[rule.id] !== undefined;
    for (const i of found) {
      if (!inPaths(i.path, opts.paths)) continue;
      issues.push(overridden ? { ...i, severity } : i);
    }
  }
  for (const i of vault.configIssues) issues.push(i);
  const sorted = sortIssues(issues);
  return {
    issues: sorted,
    errors: sorted.filter((i) => i.severity === "error").length,
    warnings: sorted.filter((i) => i.severity === "warning").length,
    checked: targets.length,
  };
}

/**
 * Returns the file operations that resolve every fixable issue in a report. Fixes to the
 * same note compose, and applying the result then fixing again yields no further ops.
 */
export async function fix(
  vault: Vault,
  report: LintReport,
  opts: FixOptions = {},
): Promise<FileOp[]> {
  const fc = new FixContext(vault, {
    now: opts.now ?? new Date(),
    newId: opts.newId ?? (() => newId(vault.profile.id_prefix)),
  });
  const fixable = report.issues.filter((i) => i.fixable);
  for (const rule of RULES) {
    if (!rule.fix) continue;
    const mine = fixable.filter((i) => i.rule === rule.id);
    if (mine.length) await rule.fix(fc, mine);
  }
  let ops = fc.ops();
  const regenIndexes = new Set(
    fixable.filter((i) => i.rule === "okf/reserved-files").map((i) => i.path),
  );
  const regenHubs = fixable.some((i) => i.rule === "lore/hub-members");
  if (regenIndexes.size || regenHubs) {
    const next = ops.length ? await loadVault(new OverlaySource(vault.src, ops)) : vault;
    const generated = await generateIndexes(next, opts.now ? { now: opts.now } : {});
    const wanted = generated.filter(
      (op) =>
        (regenIndexes.has(op.path) && basename(op.path) === "index.md") ||
        (regenHubs && hubKindOf(vault.root, op.path) !== null),
    );
    ops = compactOps([...ops, ...wanted]);
  }
  return ops;
}

export { RULES } from "./rules.ts";
export type { Rule, RuleConfig, LintReport, FixOptions } from "./engine.ts";
