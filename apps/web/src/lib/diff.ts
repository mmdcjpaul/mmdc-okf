import { diffLines } from "diff";

export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
  /** Line numbers in the old and new text; null on the side the line does not exist. */
  before: number | null;
  after: number | null;
}

export interface DiffHunk {
  lines: DiffLine[];
  /** Unchanged lines hidden before this hunk. */
  skipped: number;
}

export interface NoteDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** Unchanged lines hidden after the last hunk. */
  trailing: number;
}

/** Line diff of two versions of a note, with `context` unchanged lines around each change. */
export function diffNote(before: string | null, after: string | null, context = 3): NoteDiff {
  const lines: DiffLine[] = [];
  let b = 1;
  let a = 1;
  for (const part of diffLines(before ?? "", after ?? "")) {
    const texts = part.value.replace(/\n$/, "").split("\n");
    for (const text of texts) {
      if (part.added) lines.push({ kind: "add", text, before: null, after: a++ });
      else if (part.removed) lines.push({ kind: "remove", text, before: b++, after: null });
      else lines.push({ kind: "same", text, before: b++, after: a++ });
    }
  }

  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++)
      keep[j] = true;
  });

  const hunks: DiffHunk[] = [];
  let skipped = 0;
  let current: DiffHunk | null = null;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      skipped++;
      current = null;
      return;
    }
    if (!current) {
      current = { lines: [], skipped };
      hunks.push(current);
      skipped = 0;
    }
    current.lines.push(l);
  });
  return {
    hunks,
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "remove").length,
    trailing: skipped,
  };
}
