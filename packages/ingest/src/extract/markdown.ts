/** Small helpers for writing markdown from structured data. */

/** A cell's text on one line, with the characters that would break a table escaped. */
export function cell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** A GFM table. The first row is the header. */
export function table(rows: unknown[][]): string {
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: unknown[]) =>
    `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`;
  return [
    line(rows[0]!),
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...rows.slice(1).map(line),
  ].join("\n");
}

/** Collapses the blank lines conversion leaves behind, and ends with one newline. */
export function tidy(markdown: string): string {
  return (
    markdown
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

/** The first heading, as the document's title. */
export function firstHeading(markdown: string): string | null {
  const m = /^#{1,3}\s+(.+?)\s*#*$/m.exec(markdown);
  return m ? m[1]!.replace(/[*_`]/g, "").trim() : null;
}
