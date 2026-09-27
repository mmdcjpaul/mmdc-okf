/**
 * Additive-only check for migrations. Rolling back Lore means deploying the previous image
 * against the same database, so a migration must not remove or tighten anything the previous
 * image still uses. Expand now, contract in a later release (TECH_STACK section 7).
 */

export interface MigrationProblem {
  file: string;
  line: number;
  statement: string;
  reason: string;
}

/**
 * A contracting statement is allowed when the line before it explains why it is safe:
 * `-- lore:contract <reason>`, for example once no deployed image reads the column.
 */
const ALLOW = /^--\s*lore:contract\s+\S+/i;

const RULES: [RegExp, string][] = [
  [/\bDROP\s+TABLE\b/i, "drops a table"],
  [/\bDROP\s+COLUMN\b/i, "drops a column"],
  [/\bDROP\s+TYPE\b/i, "drops a type"],
  [/\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b/i, "renames something the previous image reads"],
  [/\bALTER\s+COLUMN\b[^;]*\bSET\s+NOT\s+NULL\b/i, "makes a column required"],
  [/\bALTER\s+COLUMN\b[^;]*\b(SET\s+DATA\s+)?TYPE\b/i, "changes a column's type"],
  [/\bTRUNCATE\b/i, "deletes rows"],
];

function addsRequiredColumnWithoutDefault(statement: string): boolean {
  const m = /\bADD\s+COLUMN\b([^;]*)/i.exec(statement);
  if (!m) return false;
  return /\bNOT\s+NULL\b/i.test(m[1]!) && !/\bDEFAULT\b/i.test(m[1]!);
}

/** Problems in one migration file. Drizzle separates statements with a breakpoint comment. */
export function checkMigration(file: string, sql: string): MigrationProblem[] {
  const problems: MigrationProblem[] = [];
  const lines = sql.split("\n");
  let start = 0;
  let buffer: string[] = [];
  const flush = (end: number) => {
    const text = buffer.join("\n");
    const statement = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const allowed = buffer.some((l) => ALLOW.test(l.trim()));
    if (statement && !allowed) {
      const line = start + 1 + buffer.findIndex((l) => l.trim() && !l.trim().startsWith("--"));
      for (const [pattern, reason] of RULES) {
        if (pattern.test(statement)) problems.push({ file, line, statement, reason });
      }
      if (addsRequiredColumnWithoutDefault(statement)) {
        problems.push({
          file,
          line,
          statement,
          reason: "adds a required column without a default, so the previous image cannot insert",
        });
      }
    }
    buffer = [];
    start = end;
  };
  lines.forEach((l, i) => {
    buffer.push(l);
    if (l.includes("--> statement-breakpoint") || l.trimEnd().endsWith(";")) flush(i + 1);
  });
  flush(lines.length);
  return problems;
}
