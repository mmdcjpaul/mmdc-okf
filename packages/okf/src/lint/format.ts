import type { Issue } from "../types.ts";
import type { LintReport } from "./engine.ts";

export type ReportFormat = "human" | "json" | "github";

/** Issues grouped by file, one line each, with a summary. */
export function formatHuman(report: LintReport): string {
  if (report.issues.length === 0) return `✔ ${report.checked} notes checked, no problems\n`;
  const byFile = new Map<string, Issue[]>();
  for (const i of report.issues) byFile.set(i.path, [...(byFile.get(i.path) ?? []), i]);
  const lines: string[] = [];
  for (const [path, issues] of byFile) {
    lines.push(path);
    for (const i of issues) {
      const pos = `${i.line ?? 1}:${i.column ?? 1}`.padEnd(8);
      const sev = i.severity.padEnd(8);
      lines.push(`  ${pos}${sev}${i.message}  ${i.rule}${i.fixable ? " (fixable)" : ""}`);
    }
    lines.push("");
  }
  const fixable = report.issues.filter((i) => i.fixable).length;
  lines.push(
    `✖ ${report.errors} ${report.errors === 1 ? "error" : "errors"}, ${report.warnings} ${report.warnings === 1 ? "warning" : "warnings"} in ${byFile.size} ${byFile.size === 1 ? "file" : "files"}` +
      (fixable ? ` (${fixable} fixable with --fix)` : ""),
  );
  return lines.join("\n") + "\n";
}

export function formatJson(report: LintReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** GitHub Actions workflow commands, which show as annotations on pull requests. */
export function formatGithub(report: LintReport): string {
  return (
    report.issues
      .map((i) => {
        const kind = i.severity === "error" ? "error" : "warning";
        const props = [
          `file=${escapeProperty(i.path)}`,
          `line=${i.line ?? 1}`,
          `col=${i.column ?? 1}`,
          `title=${escapeProperty(i.rule)}`,
        ];
        return `::${kind} ${props.join(",")}::${escapeData(i.message)}`;
      })
      .join("\n") + (report.issues.length ? "\n" : "")
  );
}

export function formatReport(report: LintReport, format: ReportFormat): string {
  if (format === "json") return formatJson(report);
  if (format === "github") return formatGithub(report);
  return formatHuman(report);
}
