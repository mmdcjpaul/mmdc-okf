import { describe, expect, it } from "vitest";
import { diffNote } from "../src/lib/diff";

const lines = (n: number, prefix = "line") =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join("\n") + "\n";

describe("diffNote", () => {
  it("shows a changed line with context and hides the rest", () => {
    const before = lines(20);
    const after = before.replace("line 10\n", "line ten\n");
    const d = diffNote(before, after);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0]!.skipped).toBe(6);
    expect(d.trailing).toBe(7);
    expect(d.hunks[0]!.lines.map((l) => l.kind)).toEqual([
      "same",
      "same",
      "same",
      "remove",
      "add",
      "same",
      "same",
      "same",
    ]);
    const removed = d.hunks[0]!.lines.find((l) => l.kind === "remove")!;
    const added = d.hunks[0]!.lines.find((l) => l.kind === "add")!;
    expect(removed).toMatchObject({ text: "line 10", before: 10, after: null });
    expect(added).toMatchObject({ text: "line ten", before: null, after: 10 });
  });

  it("keeps separate changes in separate hunks", () => {
    const before = lines(40);
    const after = before.replace("line 5\n", "five\n").replace("line 30\n", "thirty\n");
    expect(diffNote(before, after).hunks).toHaveLength(2);
  });

  it("treats a new note as all additions and a deleted note as all removals", () => {
    expect(diffNote(null, lines(3))).toMatchObject({ added: 3, removed: 0 });
    expect(diffNote(lines(3), null)).toMatchObject({ added: 0, removed: 3 });
  });

  it("has no hunks when the text is unchanged (a pure move)", () => {
    expect(diffNote(lines(5), lines(5)).hunks).toEqual([]);
  });
});
