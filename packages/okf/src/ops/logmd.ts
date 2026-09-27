/**
 * Adds an entry to an OKF `log.md` (newest first, `## YYYY-MM-DD` sections). When today's
 * section is on top, the entry goes first in it; otherwise a new section is added on top.
 */
export function appendLogEntry(
  text: string | null,
  heading: string,
  date: string,
  entry: string,
): string {
  const bullet = `- ${entry}`;
  if (text === null || text.trim() === "") return `# ${heading}\n\n## ${date}\n\n${bullet}\n`;
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.startsWith("## "));
  if (first >= 0 && lines[first]!.trim() === `## ${date}`) {
    let at = first + 1;
    while (at < lines.length && lines[at]!.trim() === "") at++;
    lines.splice(at, 0, bullet);
    return lines.join("\n");
  }
  const section = [`## ${date}`, "", bullet, ""];
  if (first >= 0) {
    lines.splice(first, 0, ...section);
    return lines.join("\n");
  }
  const trimmed = text.replace(/\s+$/, "");
  return `${trimmed}\n\n${section.join("\n")}`;
}
